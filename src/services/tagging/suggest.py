"""Auto-tagging: workbook cells → suggested (concept, period) per value cell. Stateless and deterministic without the
LLM; the desktop app stores the result as suggestions and writes no fact until the user accepts one.

    sheets ─▶ layout (layout.py) ─▶ candidates (candidates.py) ─▶ optional LLM rerank (rerank.py) ─▶ assemble

Assemble: CY and PY cells of a row share the concept; one fact comes from one cell, so when two rows land on the
same element the better one keeps it (statement before note, then confidence) and the other falls back to its next
candidate. A row equal in amount to the keeper is the same figure shown twice and gets no suggestion of its own.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from src.services.tagging.candidates import Candidate, CandidateGenerator, MemoryItem, RowCandidates
from src.services.tagging.catalog import ConceptInfo, TaggingCatalog
from src.services.tagging.layout import SheetLayout, analyse_sheet
from src.services.tagging.rerank import Reranker, RerankItem, RerankOption
from src.services.tagging.share_capital import share_capital_suggestions
from src.services.tagging.subclass_also import NoteEvidence, subclassification_also
from src.services.tagging.table_catalog import one_class_also, table_catalog_for
from src.services.tagging.table_suggest import suggest_tables
from src.services.tagging.tables import TableBlockSuggestion

REVIEW_BELOW = 0.6  # suggestions under this confidence are flagged "needs review"
MIN_CONFIDENCE = 0.5  # under this a guess is noise (DGPL: 4 of 25 right): the row is left for the user
SAME_FIGURE = 0.01  # in the sheet's units: 119.86634 and 119.86674 lakhs are one figure shown twice
_OPENING = re.compile(r"\b(?:beginning|opening)\b", re.I)
RERANK_BELOW = 0.8
ALSO_FROM = 0.9  # "also report as" suggestions ride only on statement suggestions this sure  # lexical suggestions under this go to the LLM, when enabled
TAGGABLE_KINDS = ("balance_sheet", "profit_loss", "cash_flow", "equity", "notes")
_KIND_PRIORITY = {"balance_sheet": 0, "profit_loss": 0, "cash_flow": 1, "equity": 1, "notes": 2}


@dataclass
class SuggestOptions:
    max_candidates: int = 10
    use_llm: bool = False


@dataclass
class SuggestResult:
    layouts: list[SheetLayout]
    suggestions: list[dict]
    rows: list[RowCandidates] = field(default_factory=list)
    llm_used: bool = False
    # table suggestions (ADR-0013): blocks of note sheets mapped to taxonomy tables
    blocks: list[TableBlockSuggestion] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "layout": [
                {
                    "sheet": l.sheet, "kind": l.kind, "scale": l.scale, "periodColumns": l.period_columns,
                    "rows": len(l.rows), "note": l.note,
                }
                for l in self.layouts
            ],
            "suggestions": self.suggestions,
            "blocks": [b.to_json() for b in self.blocks],
            "llmUsed": self.llm_used,
        }


def suggest(
    catalog: TaggingCatalog,
    sheets: list[dict],
    cy_end: dt.date,
    py_end: dt.date | None,
    memory: list[MemoryItem] | None = None,
    options: SuggestOptions | None = None,
    reranker: Reranker | None = None,
) -> SuggestResult:
    opts = options or SuggestOptions()
    gen = CandidateGenerator(catalog, memory, max_candidates=opts.max_candidates)
    layouts: list[SheetLayout] = []
    rows: list[RowCandidates] = []
    for sheet in sheets:
        layout = analyse_sheet(sheet, cy_end, py_end)
        if layout.kind not in TAGGABLE_KINDS and layout.rows:
            layout.note, layout.rows = "Not a statement or note sheet (trial balance, working paper): skipped", []
        layouts.append(layout)
        rows.extend(gen.for_row(r, layout.kind) for r in layout.rows)

    llm_used = False
    if opts.use_llm and reranker is not None:
        llm_used = _rerank(rows, catalog, reranker)
    suggestions = _assemble(rows, catalog)
    try:
        tables = table_catalog_for(catalog.taxonomy_id)
    except LookupError:
        tables = None
    blocks = suggest_tables(tables, sheets, layouts, cy_end, py_end) if tables else []
    if tables:
        mapped = {b.table_id for b in blocks}
        evidence = NoteEvidence(sheets, layouts)
        label_of = lambda q: catalog.concepts[q].label  # noqa: E731
        # "also report as": the same figure under the one class of a classes axis, or in the table that sub-classifies it
        for s in suggestions:
            if s["confidence"] < ALSO_FROM:
                continue  # only on sure tags: a wrong cell would be filed twice
            # a table a suggested block maps is reported from its own cells: the figure again under one of its
            # members would be counted twice by the parent-member roll-ups (changes in equity)
            found = [*one_class_also(tables, s["concept"]), *subclassification_also(tables, label_of, s, evidence)]
            also = [a for a in found if a["tableId"] not in mapped]
            if also:
                s["also"] = also
        # the share capital note's facts (counts in its text): they replace the statement tagger's guesses on those cells
        note = share_capital_suggestions(tables, sheets, layouts, py_end)
        suggestions = [s for s in suggestions if (s["cell"]["sheet"], s["cell"]["ref"]) not in note.cells] + note.suggestions
    return SuggestResult(layouts=layouts, suggestions=suggestions, rows=rows, llm_used=llm_used, blocks=blocks)


def _rerank(rows: list[RowCandidates], catalog: TaggingCatalog, reranker: Reranker) -> bool:
    undecided = [(i, rc) for i, rc in enumerate(rows) if rc.best and rc.best.origin == "lexical" and rc.best.confidence < RERANK_BELOW]
    if not undecided:
        return False
    items = [
        RerankItem(
            id=i, label=rc.row.label, context=rc.row.context, sheet_kind=rc.kind,
            options=[RerankOption(c.qname, catalog.concepts[c.qname].label, catalog.concepts[c.qname].period_type,
                                  catalog.concepts[c.qname].balance) for c in rc.candidates],
        )
        for i, rc in undecided
    ]
    choices = reranker.rerank(items)
    for i, rc in undecided:
        choice = choices.get(i)
        if choice is None:
            continue
        if choice.qname is None:
            rc.candidates = []  # the model saw nothing that fits: leave the row untagged
            continue
        picked = next(c for c in rc.candidates if c.qname == choice.qname)
        rest = [c for c in rc.candidates if c.qname != choice.qname]
        rc.candidates = [Candidate(picked.qname, max(picked.confidence, choice.confidence), "ai",
                                   f"AI: {choice.rationale}" if choice.rationale else "AI rerank", sign=picked.sign), *rest]
    return bool(choices)


def _scopes(rc: RowCandidates, info: ConceptInfo) -> dict[str, str]:
    """cell scope → fact scope. An opening balance ("… at the beginning of the year") in a year column is the
    previous year-end's figure: its CY cell reports the PY instant, and its PY cell a year the filing doesn't have."""
    opening = info.period_type == "instant" and rc.row.period_type != "instant" and _OPENING.search(rc.row.label)
    if not opening:
        return {s: s for s in rc.row.cells}
    return {"CY": "PY"} if "CY" in rc.row.cells else {}


def _assemble(rows: list[RowCandidates], catalog: TaggingCatalog) -> list[dict]:
    order = sorted(range(len(rows)), key=lambda i: (
        _KIND_PRIORITY.get(rows[i].kind, 3),
        all(abs(v) < SAME_FIGURE for v in rows[i].row.values.values()),  # a zero line yields to a line with figures
        -(rows[i].best.confidence if rows[i].best else 0)))
    taken: dict[tuple[str, str], float] = {}  # (concept, fact scope) → the value that claimed it
    chosen: dict[int, tuple[Candidate, dict[str, str]]] = {}
    for i in order:
        rc = rows[i]
        for cand in rc.candidates:
            if cand.confidence < MIN_CONFIDENCE:
                break
            scopes = _scopes(rc, catalog.concepts[cand.qname])
            if not scopes:
                continue
            keys = {cell: (cand.qname, fact) for cell, fact in scopes.items()}
            clashes = [cell for cell, k in keys.items() if k in taken]
            if not clashes:
                chosen[i] = (cand, scopes)
                for cell, k in keys.items():
                    taken[k] = rc.row.values[cell]
                break
            if all(abs(taken[keys[cell]] - rc.row.values[cell]) < SAME_FIGURE for cell in clashes):
                break  # the same figure shown again (a note total = the statement line): already suggested
    out = []
    for i, rc in enumerate(rows):
        if i not in chosen:
            continue
        cand, scopes = chosen[i]
        info = catalog.concepts[cand.qname]
        alternatives = [
            {"concept": c.qname, "label": catalog.concepts[c.qname].label, "score": c.confidence}
            for c in rc.candidates if c.qname != cand.qname
        ][:5]
        for cell_scope, scope in scopes.items():
            ref = rc.row.cells[cell_scope]
            out.append({
                "cell": {"sheet": rc.row.sheet, "ref": ref},
                "label": rc.row.label,
                "context": rc.row.context,
                "sheetKind": rc.kind,
                "concept": cand.qname,
                "conceptLabel": info.label,
                "scope": scope,
                "dims": [],
                "sign": cand.sign,
                "confidence": round(cand.confidence, 2),
                "origin": cand.origin,
                "rationale": cand.rationale,
                "needsReview": cand.confidence < REVIEW_BELOW,
                "alternatives": alternatives,
            })
    return out
