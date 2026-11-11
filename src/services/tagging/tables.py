"""Table suggestions (ADR-0013): a block of a note sheet → one taxonomy table, its rows → line items (or members), its
columns → members, its periods from the row labels and headers. Deterministic and taxonomy-generic: tables, line items
and members come from the engine authority (knowledge_base/<kb>_engine_authority.json), never from codes.

    sheet ─▶ find_blocks (a header over 2+ value columns, figure rows below, headings in between)
          ─▶ match_block (best table: column headers ↔ members of one axis, row labels ↔ line items)
          ─▶ assign (rows: line item + period role + year, group headings → members of another axis; columns: members)

The result is a TableBlockSuggestion: the same row / column shape the app's "Map as table" takes, plus every cell's
planned fact (for the evaluation and the preview). The app re-plans it with the engine before tagging anything.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from functools import lru_cache

from src.services.tagging.layout import a1
from src.services.tagging.text import header_dates, tokens

PERIOD_ROLES = ("periodStartLabel", "periodEndLabel")
# accountants' words for the taxonomy's (applied before tokenising)
PHRASES = [
    (re.compile(r"\bgross\s+block\b", re.I), "gross carrying amount"),
    (re.compile(r"\bnet\s+(?:block|carrying\s+(?:amount|value))\b", re.I), "carrying amount"),
    (re.compile(r"\baccumulated\s+depreciation\b", re.I), "accumulated depreciation impairment"),
    (re.compile(r"\b(?:charge|depreciation)\s+for\s+the\s+(?:year|period)\b", re.I), "depreciation"),
    (re.compile(r"\bprofit\s*/?\s*\(?\s*loss\s*\)?\s+for\s+the\s+(?:year|period)\b", re.I), "profit loss for period"),
    (re.compile(r"\bdeletions?\b", re.I), "disposals"),
]
_BALANCE = re.compile(r"\b(?:balance|as\s+at|as\s+on|opening|closing)\b", re.I)
_TOTAL = re.compile(r"^\s*total\b", re.I)
_FY = re.compile(r"\b(?:fy\s*)?(\d{4})\s*[-–/]\s*(\d{2}|\d{4})\b", re.I)
MIN_TABLE_SCORE = 0.45
MIN_MATCH = 0.5


def text_tokens(s: str) -> frozenset[str]:
    t = str(s)
    for rx, rep in PHRASES:
        t = rx.sub(rep, t)
    return frozenset(w for w in tokens(t) if w not in ("member", "table", "axis", "abstract"))


def contains(text: frozenset[str], label: frozenset[str]) -> float:
    """A label all of whose words appear in a longer text ("Gross Block Balance as at …" names "Gross carrying amount")."""
    return min(0.99, 0.85 + 0.03 * len(label)) if label and label <= text else 0.0  # the longest named member wins


def similarity(text: frozenset[str], label: frozenset[str]) -> float:
    """How well a row / header text names a label: all its words in the label scores high, then by overlap."""
    if not text or not label:
        return 0.0
    common = len(text & label)
    if not common:
        return 0.0
    if text <= label:
        return 0.6 + 0.4 * len(text) / len(label)
    return 2 * common / (len(text) + len(label)) * 0.8


# ------------------------------------------------------------------ the taxonomy's tables
@dataclass(frozen=True)
class TableItem:
    concept: str
    label: str
    tokens: frozenset[str]
    preferred_label: str | None
    period_type: str | None
    data_type: str | None


@dataclass(frozen=True)
class TableMember:
    member: str
    label: str
    tokens: frozenset[str]
    usable: bool
    is_default: bool


@dataclass(frozen=True)
class TableAxis:
    axis: str
    typed: bool
    members: tuple[TableMember, ...]


@dataclass(frozen=True)
class TableInfo:
    id: str
    title: str
    items: tuple[TableItem, ...]
    axes: tuple[TableAxis, ...]
    # words most of the table's line items share (its subject: "property plant equipment"); rows rarely repeat them
    subject: frozenset[str] = frozenset()

    def item_tokens(self, item: TableItem) -> frozenset[str]:
        own = item.tokens - self.subject
        return own or item.tokens

    @property
    def balance_concept(self) -> str | None:
        """The element the table rolls forward (it has both an opening and a closing row), if exactly one."""
        roles: dict[str, set] = {}
        for i in self.items:
            if i.preferred_label in PERIOD_ROLES:
                roles.setdefault(i.concept, set()).add(i.preferred_label)
        both = [q for q, r in roles.items() if len(r) == 2]
        return both[0] if len(both) == 1 else None


NUMERIC = {"xbrli:monetaryItemType", "xbrli:sharesItemType", "num:perShareItemType", "xbrli:decimalItemType", "num:percentItemType", "xbrli:pureItemType"}


class TableCatalog:
    def __init__(self, authority: dict):
        concepts = authority["concepts"]
        defaults = authority.get("dimensionDefaults", {})
        presentation = authority.get("presentation", {})

        def label(q: str, role: str | None) -> str:
            labels = (concepts.get(q) or {}).get("labels") or {}
            return labels.get(role or "label") or labels.get("label") or q

        self.tables: list[TableInfo] = []
        for t in authority["tables"]:
            if not t["axes"]:
                continue
            items = _line_items(t, presentation.get(t.get("presentationElr") or "", []), concepts, label)
            axes = tuple(
                TableAxis(
                    ax["axis"], bool(ax.get("typed")),
                    tuple(
                        TableMember(m["member"], label(m["member"], None), text_tokens(label(m["member"], None)), bool(m.get("usable")), defaults.get(ax["axis"]) == m["member"])
                        for m in ax.get("members", [])
                    ),
                )
                for ax in t["axes"]
            )
            self.tables.append(TableInfo(t["id"], label(t["hypercube"], None), items, axes, _subject(items)))


def _subject(items: tuple[TableItem, ...]) -> frozenset[str]:
    if len(items) < 4:
        return frozenset()
    counts: dict[str, int] = {}
    for i in {x.concept: x for x in items}.values():
        for w in i.tokens:
            counts[w] = counts.get(w, 0) + 1
    n = len({x.concept for x in items})
    return frozenset(w for w, k in counts.items() if k >= 0.4 * n)


def _line_items(t: dict, arcs: list[dict], concepts: dict, label) -> tuple[TableItem, ...]:
    """The table's line items in presentation order, one per (element, label role) — the engine's buildTableView."""
    line = {n["concept"] for n in t.get("lineItemTree", [])}
    children: dict[str, list[dict]] = {}
    for a in arcs:
        children.setdefault(a["from"], []).append(a)
    for v in children.values():
        v.sort(key=lambda a: a.get("order", 0))
    out: list[TableItem] = []
    seen: set[tuple[str, str]] = set()

    def walk(q: str) -> None:
        for a in children.get(q, []):
            key = (a["to"], a.get("preferredLabel") or "")
            if a["to"] not in line or key in seen:
                continue
            seen.add(key)
            c = concepts.get(a["to"]) or {}
            if not c.get("abstract") and c.get("type") in NUMERIC:
                text = label(a["to"], a.get("preferredLabel"))
                out.append(TableItem(a["to"], text, text_tokens(label(a["to"], None)) | text_tokens(text), a.get("preferredLabel"), c.get("periodType"), c.get("type")))
            walk(a["to"])

    walk(t.get("primaryItem") or "")
    for n in t.get("lineItemNodes", []):
        walk(n)
    return tuple(out)


_NUMBERED_FIRST = re.compile(r"^[A-Za-z]+?1Member$")
ONE_CLASS_CONFIDENCE = 0.7  # under 0.9: never accepted in bulk


def one_class_also(catalog: TableCatalog, concept: str) -> list[dict]:
    """'Also report as' for a company with one class (ADR-0013): the element under the first numbered member of the
    table's one "classes" axis (Equity shares 1), when every other axis of that table can stay at its default. MCA
    filings report a single class of shares this way (share capital, the share counts, EPS)."""
    out = []
    for t in catalog.tables:
        items = [i for i in t.items if i.concept == concept and i.preferred_label != "periodStartLabel"]
        if not items:
            continue
        numbered = [(a, m) for a in t.axes if not a.typed for m in a.members if m.usable and _NUMBERED_FIRST.match(m.member.split(":")[-1])]
        axes_with_first = {a.axis for a, _ in numbered}
        if len(axes_with_first) != 1:
            continue
        axis, member = numbered[0]
        others_ok = all(any(m.is_default and m.usable for m in a.members) for a in t.axes if a.axis != axis.axis)
        if not others_ok:
            continue
        item = next((i for i in items if i.preferred_label == "periodEndLabel"), items[0])
        out.append({"concept": concept, "tableId": t.id, "preferredLabel": item.preferred_label, "dims": [{"axis": axis.axis, "member": member.member}], "confidence": ONE_CLASS_CONFIDENCE, "reason": "one class"})
    return sorted(out, key=lambda x: x["tableId"])[:1]


@lru_cache(maxsize=4)
def table_catalog_for(taxonomy_id: str) -> TableCatalog:
    import json

    from src.services.engine_authority.specs import SPECS

    spec = SPECS.get(taxonomy_id)
    if spec is None or not spec.output.exists():
        raise LookupError(f"Taxonomy '{taxonomy_id}' has no engine authority")
    with spec.output.open(encoding="utf-8") as fh:
        return TableCatalog(json.load(fh))


# ------------------------------------------------------------------ blocks in a sheet
@dataclass
class BlockColumn:
    c: int
    header: str
    scope: str | None = None
    total: bool = False


@dataclass
class BlockRow:
    r: int
    label: str
    values: dict[int, float] = field(default_factory=dict)

    @property
    def heading(self) -> bool:
        return not self.values


@dataclass
class Block:
    sheet: str
    r1: int
    r2: int
    c1: int
    c2: int
    columns: list[BlockColumn]
    rows: list[BlockRow]


def _scope_of(text: str, cy_end: dt.date, py_end: dt.date | None) -> str | None:
    for d in header_dates(text):
        if d == cy_end:
            return "CY"
        if py_end and d == py_end:
            return "PY"
    for y1, y2 in _FY.findall(text):  # "2025-26": the year ending in 2026
        end = int(y2) if len(y2) == 4 else int(y1[:2] + y2)
        if end == cy_end.year and int(y1) == end - 1:
            return "CY"
        if py_end and end == py_end.year and int(y1) == end - 1:
            return "PY"
    return None


def find_blocks(sheet: dict, cy_end: dt.date, py_end: dt.date | None) -> list[Block]:
    """Blocks of figures under a header of 2+ value columns that name something other than a year alone."""
    grid: dict[int, dict[int, object]] = {}
    for cell in sheet["cells"]:
        grid.setdefault(cell["r"], {})[cell["c"]] = cell["v"]
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)  # noqa: E731
    numeric_rows = sorted(r for r, row in grid.items() if sum(1 for v in row.values() if num(v)) >= 2)
    groups: list[list[int]] = []
    for r in numeric_rows:
        if groups and r - groups[-1][-1] <= 4 and _overlap(grid, groups[-1][-1], r, num) >= 0.5:
            groups[-1].append(r)
        else:
            groups.append([r])
    blocks: list[Block] = []
    for rows in groups:
        if len(rows) < 2:
            continue
        counts: dict[int, int] = {}
        for r in rows:
            for c, v in grid[r].items():
                if num(v):
                    counts[c] = counts.get(c, 0) + 1
        cols = sorted(c for c, n in counts.items() if n >= max(2, len(rows) // 2))
        if len(cols) < 2:
            continue
        first = rows[0]
        columns = []
        for c in cols:
            texts = [str(grid.get(r, {}).get(c)).strip() for r in range(max(0, first - 5), first) if isinstance(grid.get(r, {}).get(c), str) and str(grid[r][c]).strip()]
            header = " ".join(texts)
            columns.append(BlockColumn(c, header, _scope_of(header, cy_end, py_end), bool(_TOTAL.match(texts[-1])) if texts else False))
        named = [col for col in columns if col.header and not col.total and not _only_period(col.header, cy_end, py_end)]
        if not named:
            continue  # a plain CY / PY note: the statement tagger's job
        label_col = min(cols)
        block_rows = []
        for r in range(first, rows[-1] + 1):
            row = grid.get(r, {})
            texts = [str(v).strip() for c, v in sorted(row.items()) if c < label_col and isinstance(v, str) and str(v).strip()]
            values = {c: float(row[c]) for c in cols if num(row.get(c))}
            if texts or values:
                block_rows.append(BlockRow(r, " ".join(texts[:1]), values))
        # the heading rows just above the first figures belong to it ("Gross Block", "Tangible Assets")
        for r in range(first - 1, max(-1, first - 3), -1):
            row = grid.get(r, {})
            texts = [str(v).strip() for c, v in sorted(row.items()) if c < label_col and isinstance(v, str) and str(v).strip()]
            if texts and not any(num(v) for v in row.values()) and not any(isinstance(row.get(c), str) for c in cols):
                block_rows.insert(0, BlockRow(r, texts[0]))
            else:
                break
        rmin = min(x.r for x in block_rows)
        blocks.append(Block(sheet["name"], rmin, rows[-1], label_col_of(grid, block_rows, label_col), max(cols), columns, block_rows))
    return blocks


def label_col_of(grid: dict, rows: list[BlockRow], first_value_col: int) -> int:
    cs = [c for x in rows for c, v in grid.get(x.r, {}).items() if c < first_value_col and isinstance(v, str) and str(v).strip()]
    return min(cs) if cs else first_value_col


def _overlap(grid: dict, r1: int, r2: int, num) -> float:
    a = {c for c, v in grid[r1].items() if num(v)}
    b = {c for c, v in grid[r2].items() if num(v)}
    return len(a & b) / max(1, min(len(a), len(b)))


def _only_period(text: str, cy_end: dt.date, py_end: dt.date | None) -> bool:
    """A header that only says which year ("As at 31 March 2026", "2025-26")."""
    stripped = _FY.sub(" ", re.sub(r"\d", " ", text))
    words = text_tokens(stripped) - {"march", "april", "year", "period", "ended", "end", "st", "th", "particulars", "amount", "rs", "lakh", "lakhs"}
    return not words and (_scope_of(text, cy_end, py_end) is not None or not text_tokens(stripped))


# ------------------------------------------------------------------ block → table
@dataclass
class CellSuggestion:
    ref: str
    concept: str
    scope: str
    preferred_label: str | None
    dims: list[dict]
    confidence: float


@dataclass
class TableBlockSuggestion:
    sheet: str
    range: str
    table_id: str
    table_title: str
    confidence: float
    rows: list[dict]
    cols: list[dict]
    cells: list[CellSuggestion]

    def to_json(self) -> dict:
        return {
            "sheet": self.sheet, "range": self.range, "tableId": self.table_id, "tableTitle": self.table_title,
            "confidence": round(self.confidence, 3), "rows": self.rows, "cols": self.cols,
            "cells": [{"ref": c.ref, "concept": c.concept, "scope": c.scope, "preferredLabel": c.preferred_label, "dims": c.dims, "confidence": round(c.confidence, 3)} for c in self.cells],
        }


def _best_member(axis: TableAxis, text: frozenset[str]) -> tuple[TableMember | None, float]:
    best, score = None, 0.0
    for m in axis.members:
        if not m.usable:
            continue
        s = similarity(text, m.tokens)
        if s > score or (s == score and best is not None and len(m.tokens) < len(best.tokens)):
            best, score = m, s
    return best, score


def _best_item(t: TableInfo, text: frozenset[str], balance: bool) -> tuple[TableItem | None, float]:
    best, score = None, 0.0
    for i in t.items:
        if i.preferred_label == "periodStartLabel":
            continue  # opening rows are found by their dates
        if balance and i.period_type != "instant":
            continue
        toks = t.item_tokens(i)
        s = similarity(text, toks)
        if s > score or (s == score and best is not None and len(toks) < len(t.item_tokens(best))):
            best, score = i, s
    return best, score


def match_block(block: Block, catalog: TableCatalog) -> tuple[TableInfo, TableAxis, float] | None:
    """The table whose members name the block's columns (one axis) and whose line items name its rows."""
    headers = [text_tokens(c.header) for c in block.columns if not c.total and c.header]
    data_rows = [r for r in block.rows if r.values and r.label]
    labels = [text_tokens(r.label) for r in data_rows]
    dated = [bool(_BALANCE.search(r.label) and header_dates(r.label)) for r in data_rows]
    best = None
    for t in catalog.tables:
        if not t.items:
            continue
        for ax in t.axes:
            if ax.typed:
                continue
            picks = [_best_member(ax, h) for h in headers]
            # two columns of one year can't be the same member ("<12 months" and ">12 months")
            named = [m.member for m, s in picks if m is not None and s >= MIN_MATCH]
            if len(named) != len(set(named)) and not _years_differ(block):
                continue
            col = sum(s for _, s in picks) / max(1, len(picks))
            if col < MIN_MATCH * 0.8:
                continue
            others = [a for a in t.axes if a.axis != ax.axis and not a.typed]
            row_scores = []
            balance = t.balance_concept
            for lab, is_balance in zip(labels, dated, strict=True):
                if balance and is_balance:
                    row_scores.append(0.9)  # "Balance as at 31 March 2025": the table's balance, by its date
                    continue
                item = _best_item(t, lab, False)[1]
                member = max((_best_member(a, lab)[1] for a in others), default=0.0)
                row_scores.append(max(item, member * 0.9))
            row = sum(row_scores) / max(1, len(row_scores))
            if row < MIN_MATCH * 0.8:
                continue
            score = 0.55 * col + 0.45 * row
            if best is None or score > best[2]:
                best = (t, ax, score)
    return best if best and best[2] >= MIN_TABLE_SCORE else None


def _years_differ(block: Block) -> bool:
    return len({c.scope for c in block.columns if c.scope}) > 1


def assign(block: Block, t: TableInfo, col_axis: TableAxis, score: float, cy_end: dt.date, py_end: dt.date | None) -> TableBlockSuggestion | None:
    others = [a for a in t.axes if a.axis != col_axis.axis and not a.typed]
    cols: list[dict] = []
    col_member: dict[int, tuple[dict | None, float]] = {}
    for c in block.columns:
        if not c.header:
            continue
        if c.total:
            # the class total: the column axis at its default (no member); MCA filings report it with the row's members
            col_member[c.c] = (None, 0.8)
            cols.append({"c": c.c, "members": [], **({"scope": c.scope} if c.scope else {})})
            continue
        m, s = _best_member(col_axis, text_tokens(c.header))
        if m is None or s < MIN_MATCH:
            continue
        dim = None if m.is_default else {"axis": col_axis.axis, "member": m.member}
        col_member[c.c] = (dim, s)
        cols.append({"c": c.c, "members": [dim] if dim else [], **({"scope": c.scope} if c.scope else {})})
    if not cols:
        return None
    balance = t.balance_concept
    py_open = py_end.replace(year=py_end.year - 1) if py_end else None
    group: dict | None = None
    rows: list[dict] = []
    row_dates = [(r.r, _row_date(r.label, cy_end, py_end, py_open)) for r in block.rows]
    for r in block.rows:
        lab = text_tokens(r.label)
        # a heading, or a label that names a member of another axis ("Gross Block …"), sets the group
        g_best, g_score, g_axis = None, 0.0, None
        for a in others:
            m, s = _best_member(a, lab)
            for x in a.members:
                if x.usable and contains(lab, x.tokens) > max(s, 0.0) and len(x.tokens) >= 2:
                    m, s = x, contains(lab, x.tokens)
            if s > g_score:
                g_best, g_score, g_axis = m, s, a
        if g_best is not None and g_score >= 0.6:
            group = None if g_best.is_default else {"axis": g_axis.axis, "member": g_best.member}
        if r.heading:
            continue
        date = dict(row_dates)[r.r]
        if balance and date and _BALANCE.search(r.label):
            role, scope = date
            rows.append({"r": r.r, "concept": balance, "preferredLabel": role, "scope": scope, "members": [group] if group else [], "_s": 0.9})
            continue
        item, s = _best_item(t, lab, False)
        if item is None or s < MIN_MATCH:
            continue
        scope = _movement_scope(r.r, row_dates)
        rows.append({"r": r.r, "concept": item.concept, "preferredLabel": item.preferred_label, **({"scope": scope} if scope else {}), "members": [group] if group else [], "_s": s})
    if not rows:
        return None
    cells: list[CellSuggestion] = []
    by_r = {r.r: r for r in block.rows}
    for row in rows:
        for c in cols:
            v = by_r[row["r"]].values.get(c["c"])
            scope = row.get("scope") or c.get("scope")
            if v is None or not scope:
                continue
            dim, cs = col_member[c["c"]]
            dims = [d for d in (*row["members"], dim) if d]
            if not dims:
                continue  # no member at all: a statement-level figure (the statement tagger's)
            cells.append(CellSuggestion(a1(row["r"], c["c"]), row["concept"], scope, row["preferredLabel"], dims, round(score * min(cs, row["_s"]), 3)))
    if not cells:
        return None
    for row in rows:
        row.pop("_s")
    rng = f"{a1(block.r1, block.c1)}:{a1(block.r2, block.c2)}"
    return TableBlockSuggestion(block.sheet, rng, t.id, t.title, score, rows, cols, cells)


def _row_date(label: str, cy_end: dt.date, py_end: dt.date | None, py_open: dt.date | None):
    """(period role, year) of a balance row from the date in its label."""
    one = dt.timedelta(days=1)
    for d in header_dates(label):
        if d == cy_end:
            return ("periodEndLabel", "CY")
        if py_end and d == py_end:
            return ("periodEndLabel", "PY")
        if py_open and (d == py_open or d == py_open + one):  # "as at 31 March 2024" or "as at 1 April 2024"
            return ("periodStartLabel", "PY")
        if py_end and d == py_end + one:  # "as at 1 April 2025": this year's opening = last year's closing
            return ("periodEndLabel", "PY")
    return None


def _movement_scope(r: int, row_dates: list[tuple[int, object]]) -> str | None:
    """A movement row belongs to the year of the next closing balance below it."""
    for rr, d in row_dates:
        if rr > r and d and d[0] == "periodEndLabel":
            return d[1]
    return None


def suggest_tables(catalog: TableCatalog, sheets: list[dict], layouts: list, cy_end: dt.date, py_end: dt.date | None) -> list[TableBlockSuggestion]:
    out: list[TableBlockSuggestion] = []
    for sheet, layout in zip(sheets, layouts, strict=True):
        if layout.kind == "other":
            continue
        for block in find_blocks(sheet, cy_end, py_end):
            m = match_block(block, catalog)
            if m is None:
                continue
            s = assign(block, m[0], m[1], m[2], cy_end, py_end)
            if s is not None:
                out.append(s)
    return out
