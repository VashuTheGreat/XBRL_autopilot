"""Candidate concepts for one sheet row, best first, each with a confidence and a one-line rationale.

Order of evidence (docs/06-ai-auto-tagging.md):
1. mapping memory: a label the user approved before → 0.97+
2. exact label: the row label equals a label role (label / terse / total / net …), word order free → 0.95;
   or does once a qualifier from its headings is added ("Trade Receivables" under CURRENT ASSETS) → 0.90
3. lexical BM25 over label words, heading words weighted lower → at most 0.85

Filters before scoring: reportable without dimensions and of a numeric type (the catalog), the period type the
sheet implies (balance sheet / "As at" → instant; P&L, cash flow / "Year ended" → duration), and the data type the
label implies (EPS → per share). Concepts presented on the statement the sheet is (by ELR title) are boosted.
"""
from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field

from src.services.tagging.catalog import NEGATED_ROLES, ConceptInfo, TaggingCatalog
from src.services.tagging.layout import TagRow
from src.services.tagging.text import PHRASE_ALIASES, STOPWORDS, norm_label, qualifier, tokens

MEMORY_CONFIDENCE = 0.97
EXACT_CONFIDENCE = 0.95
CONTEXT_EXACT_CONFIDENCE = 0.90
LEXICAL_CEILING = 0.85
CONTEXT_WEIGHT = 0.35

_SHEET_PERIOD = {"balance_sheet": "instant", "profit_loss": "duration", "cash_flow": "duration"}
_PERIOD_EDGE = re.compile(r"\b(?:beginning|opening|end of (?:the )?(?:year|period)|closing|as at)\b", re.I)
_PER_SHARE = re.compile(r"\b(?:eps|per share|earnings? per|basic|diluted)\b", re.I)
_SHARE_COUNT = re.compile(r"\bnumber of (?:equity )?shares\b|\bno\.? of shares\b", re.I)
_RATE = re.compile(r"\brate\b|%|\bpercent", re.I)
_GENERIC = frozenset({"other", "total", "net", "gross", "amount", "balance", "particular", "sundry", "miscellaneou"})


@dataclass(frozen=True)
class MemoryItem:
    label: str
    concept: str
    approvals: int = 1


@dataclass
class Candidate:
    qname: str
    confidence: float
    origin: str  # memory | exact | lexical | ai
    rationale: str
    sign: int = 1
    score: float = 0.0  # ranking score within the origin (not a probability)


@dataclass
class RowCandidates:
    row: TagRow
    kind: str
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None


def expected_types(label: str) -> set[str]:
    if _PER_SHARE.search(label):
        return {"perShare"}
    if _SHARE_COUNT.search(label):
        return {"shares"}
    if _RATE.search(label):
        return {"percent", "pure", "decimal"}
    return {"monetary"}


class CandidateGenerator:
    def __init__(self, catalog: TaggingCatalog, memory: list[MemoryItem] | None = None, max_candidates: int = 10):
        self.catalog = catalog
        self.max_candidates = max_candidates
        self.memory: dict[str, list[MemoryItem]] = {}
        for m in memory or []:
            if catalog.get(m.concept):
                self.memory.setdefault(norm_label(m.label), []).append(m)

    # ------------------------------------------------------------------ public
    def for_row(self, row: TagRow, kind: str) -> RowCandidates:
        allowed = self._allowed(row, kind)
        out: dict[str, Candidate] = {}
        for c in [*self._memory(row, allowed), *self._exact(row, kind, allowed), *self._lexical(row, kind, allowed)]:
            if c.qname not in out:  # the first (strongest) piece of evidence wins
                out[c.qname] = c
        ranked = sorted(out.values(), key=lambda c: (-c.confidence, -c.score, c.qname))  # qname: deterministic ties
        return RowCandidates(row=row, kind=kind, candidates=ranked[: self.max_candidates])

    # ------------------------------------------------------------------ filters
    def _allowed(self, row: TagRow, kind: str) -> set[str]:
        period = row.period_type or _SHEET_PERIOD.get(kind)
        # an opening / closing balance in a duration column ("Cash … at the end of the year", "Balance as at year end")
        edge = any(_PERIOD_EDGE.search(t) for t in (row.label, *row.context[-2:]))
        types = expected_types(row.label)
        qual = qualifier(row.label, row.context)
        opposite = {"current": "noncurrent", "noncurrent": "current"}.get(qual or "")
        docs = self.catalog.index.docs
        ok = set()
        for q, info in self.catalog.concepts.items():
            if info.data_type not in types:
                continue
            if period == "instant" and info.period_type != "instant":
                continue
            if period == "duration" and info.period_type == "instant" and not edge:
                continue
            if opposite and opposite in docs[q]:
                continue  # "Other Financial Assets" under NON-CURRENT ASSETS is never a current element
            ok.add(q)
        return ok

    def _boost(self, info: ConceptInfo, row: TagRow, kind: str) -> float:
        b = 1.0
        statement = bool(info.kinds & {"balance_sheet", "profit_loss"})
        if kind == "notes":
            # most note lines are a statement's line item or its breakdown (401100 / 500100): prefer those
            b *= 1.3 + (0.05 if statement and "notes" in info.kinds else 0) if (statement or "notes" in info.kinds) else 1.0
        elif kind in info.kinds:
            b *= 1.3
        if row.is_total and info.is_total:
            b *= 1.1
        return b

    # ------------------------------------------------------------------ evidence
    def _memory(self, row: TagRow, allowed: set[str]) -> list[Candidate]:
        items = [m for m in self.memory.get(norm_label(row.label), []) if m.concept in allowed]
        items.sort(key=lambda m: (-m.approvals, m.concept))
        return [
            Candidate(m.concept, min(0.99, MEMORY_CONFIDENCE + 0.005 * (m.approvals - 1)), "memory",
                      f"You tagged “{m.label}” as this before ({m.approvals}×)", score=float(m.approvals))
            for m in items
        ]

    def _exact(self, row: TagRow, kind: str, allowed: set[str]) -> list[Candidate]:
        hits: list[Candidate] = []
        label_toks = frozenset(tokens(row.label))
        if label_toks <= _GENERIC:
            return []  # "Others", "Total": an element named so says nothing about this row
        qual = qualifier(row.label, row.context)
        if qual and qual not in label_toks:
            # "Trade Receivables" under CURRENT ASSETS is "Trade receivables, current", not the classless element
            for q, role in self.catalog.by_tokens.get(label_toks | {qual}, []):
                if q in allowed:
                    hits.append(self._exact_candidate(q, role, row, kind, EXACT_CONFIDENCE,
                                                      f"Same as its {_role_name(role)} with “{qual}” from the heading above"))
            if hits:
                return self._resolve(hits)
        norm = norm_label(row.label)
        direct = {*self.catalog.by_norm.get(norm, []), *self.catalog.by_tokens.get(label_toks, [])}
        alias = PHRASE_ALIASES.get(norm)
        if alias:
            direct |= set(self.catalog.by_norm.get(norm_label(alias), []))
        for q, role in sorted(direct):
            if q in allowed:
                hits.append(self._exact_candidate(q, role, row, kind, EXACT_CONFIDENCE, f"Same as its {_role_name(role)}"))
        if not hits and label_toks:
            ctx = [t for t in dict.fromkeys(t for h in row.context for t in tokens(h)) if t not in label_toks]
            for n in (1, 2):
                for extra in itertools.combinations(ctx[-8:], n):
                    for q, role in self.catalog.by_tokens.get(label_toks | set(extra), []):
                        if q in allowed:
                            hits.append(self._exact_candidate(
                                q, role, row, kind, CONTEXT_EXACT_CONFIDENCE,
                                f"Same as its {_role_name(role)} with “{' '.join(extra)}” from the heading above",
                            ))
                if hits:
                    break
        return self._resolve(hits)

    @staticmethod
    def _resolve(hits: list[Candidate]) -> list[Candidate]:
        if not hits:
            return []
        hits.sort(key=lambda c: (-c.confidence, -c.score, c.qname))
        top = hits[0].score
        tied = [h for h in hits if h.score >= top - 1e-9]
        if len({h.qname for h in tied}) > 1:  # ambiguous: several elements carry this label
            for h in hits:
                h.confidence -= 0.15
                h.rationale += f" (also the label of {len({h.qname for h in tied}) - 1} other element(s))"
        return hits

    def _exact_candidate(self, q: str, role: str, row: TagRow, kind: str, conf: float, why: str) -> Candidate:
        info = self.catalog.concepts[q]
        boost = self._boost(info, row, kind)
        if boost < 1.3 and kind != "notes":
            conf -= 0.05  # right words, but not an element of this statement
        sign = -1 if role in NEGATED_ROLES else 1
        return Candidate(q, conf, "exact", f"{why}; {_where(info)}", sign=sign, score=boost)

    def _lexical(self, row: TagRow, kind: str, allowed: set[str]) -> list[Candidate]:
        query: dict[str, float] = {t: 1.0 for t in tokens(row.label)}
        qual = qualifier(row.label, row.context)
        if qual:
            query[qual] = 1.0
        for h in row.context:
            for t in tokens(h):
                query.setdefault(t, CONTEXT_WEIGHT)
        query = {t: w for t, w in query.items() if t not in STOPWORDS}
        if not query:
            return []
        index = self.catalog.index
        scored = []
        for q, s in index.search(query, limit=60, among=allowed):
            info = self.catalog.concepts[q]
            cov = index.coverage(q, query)
            scored.append((q, s * (0.4 + 0.6 * cov) * self._boost(info, row, kind), cov))
        scored.sort(key=lambda x: (-x[1], x[0]))
        if not scored:
            return []
        s1 = scored[0][1]
        s2 = scored[1][1] if len(scored) > 1 else 0.0
        margin = (s1 - s2) / s1 if s1 else 0.0
        label_words = {t for t, w in query.items() if w == 1.0}
        out = []
        for i, (q, s, cov) in enumerate(scored[: self.max_candidates]):
            info = self.catalog.concepts[q]
            named = len(label_words & set(index.docs[q])) / len(label_words) if label_words else 0.0
            conf = 0.25 + 0.3 * cov + 0.2 * named + (0.15 * min(1.0, margin * 3) if i == 0 else 0.0)
            conf = round(min(LEXICAL_CEILING, conf * (s / s1)), 2)
            out.append(Candidate(q, conf, "lexical",
                                 f"Words match “{info.label}” ({round(cov * 100)}% of its label); {_where(info)}", score=s))
        return out


def _role_name(role: str) -> str:
    return {
        "label": "standard label", "terseLabel": "short label", "totalLabel": "total label", "netLabel": "net label",
        "periodStartLabel": "opening label", "periodEndLabel": "closing label",
    }.get(role, "negated label")


def _where(info: ConceptInfo) -> str:
    codes = ", ".join(info.elr_codes[:3]) or "no statement"
    return f"{info.period_type}; ELR {codes}"
