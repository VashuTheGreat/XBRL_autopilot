"""Note tables (ADR-0013): blocks of figures in a sheet, and the note-table producer — a block → one taxonomy table, its
rows → line items (or members), its columns → members, its periods from the row labels and headers. Deterministic and
taxonomy-generic: tables, line items and members come from the catalog (table_catalog.py), never from codes. Other
producers (party_tables.py) reuse the blocks; table_suggest.py runs them all.

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

from src.services.tagging.layout import a1
from src.services.tagging.table_catalog import (
    MIN_MATCH,
    PERIOD_ROLES,
    TableAxis,
    TableCatalog,
    TableInfo,
    TableItem,
    TableMember,
    best_member,
    contains,
    similarity,
    text_tokens,
)
from src.services.tagging.text import header_dates

_BALANCE = re.compile(r"\b(?:balance|as\s+at|as\s+on|opening|closing)\b", re.I)
_TOTAL = re.compile(r"^\s*total\b", re.I)
_FY = re.compile(r"\b(?:fy\s*)?(\d{4})\s*[-–/]\s*(\d{2}|\d{4})\b", re.I)
MIN_TABLE_SCORE = 0.6  # 2026-11-11: every DGPL block under it was noise (0.45–0.59); real ones score 0.76+


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
    text: str = ""  # every text cell left of the figures ("B  (ii) Outstanding balances at the year end")

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


class Figures:
    """The main statements' figures by year (rounded to 2 places), with where they are: a block's column whose non-zero
    values are this year's figures is this year's, whatever its header says (DGPL's financial instruments note: "As
    at March 31, 2025" over FY 2026 figures). Only the statements count: their headers are checked against the
    filing's year ends, while notes next to a stale one often carry the same stale header."""

    STATEMENTS = ("balance_sheet", "profit_loss", "cash_flow")

    def __init__(self, layouts: list) -> None:
        self.at: dict[str, dict[float, list[tuple[str, int]]]] = {"CY": {}, "PY": {}}
        for layout in layouts:
            if layout.kind not in self.STATEMENTS:
                continue
            for row in layout.rows:
                for scope, v in row.values.items():
                    if scope in self.at and v:
                        self.at[scope].setdefault(round(v, 2), []).append((row.sheet, row.r))

    def scope_of(self, block: "Block", col: int) -> str | None:
        """CY / PY when 2+ of the column's non-zero values are that year's figures elsewhere, and more than the other
        year's (the block's own rows don't count)."""
        values = [round(r.values[col], 2) for r in block.rows if r.values.get(col)]
        elsewhere = lambda hits: any(sh != block.sheet or not block.r1 <= r <= block.r2 for sh, r in hits)  # noqa: E731
        n = {y: sum(1 for v in values if elsewhere(self.at[y].get(v, []))) for y in self.at}
        best = max(n, key=lambda y: n[y])
        return best if n[best] >= 2 and n[best] > min(n.values()) else None


NO_FIGURES = Figures([])


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
    merges = sheet.get("merges") or []
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
        above = _header_rows(grid, first, cols, num)
        spread = merged_headers(grid, merges, min(cols))
        for c in cols:
            at = [spread.get((r, c), grid.get(r, {}).get(c)) for r in above]
            texts = [str(v).strip() for v in at if isinstance(v, str) and str(v).strip()]
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
                block_rows.append(BlockRow(r, " ".join(texts[:1]), values, " ".join(texts)))
        # the heading rows just above the first figures belong to it ("Gross Block", "Tangible Assets")
        for r in range(first - 1, max(-1, first - 3), -1):
            row = grid.get(r, {})
            texts = [str(v).strip() for c, v in sorted(row.items()) if c < label_col and isinstance(v, str) and str(v).strip()]
            if texts and not any(num(v) for v in row.values()) and not any(isinstance(row.get(c), str) for c in cols):
                block_rows.insert(0, BlockRow(r, texts[0], {}, " ".join(texts)))
            else:
                break
        rmin = min(x.r for x in block_rows)
        blocks.append(Block(sheet["name"], rmin, rows[-1], label_col_of(grid, block_rows, label_col), max(cols), columns, block_rows))
    return blocks


HEADER_ROWS = 8  # how far above its figures a column's header may start ("Holding Company" over "2025-26")


def merged_headers(grid: dict, merges: list[dict], first_col: int) -> dict[tuple[int, int], str]:
    """(row, column) → the text of the merged cell that spans it: "Holding Company" over its two year columns. Only
    merges that start in a figure column (`first_col` or right of it) name columns; a title merged across the sheet
    from the label column does not. Used for column headers only."""
    out: dict[tuple[int, int], str] = {}
    for m in merges:
        text = grid.get(m["r1"], {}).get(m["c1"])
        if not isinstance(text, str) or m["c2"] <= m["c1"] or m["c1"] < first_col:
            continue
        for c in range(m["c1"] + 1, m["c2"] + 1):
            if (m["r1"], c) not in out and not isinstance(grid.get(m["r1"], {}).get(c), str):
                out[(m["r1"], c)] = text
    return out


def _header_rows(grid: dict, first: int, cols: list[int], num) -> list[int]:
    """The rows above a block's first figures that can hold its column headers: up to HEADER_ROWS, stopping at a row
    with a figure in one of its columns (the block above). Top to bottom."""
    out = []
    for r in range(first - 1, max(-1, first - 1 - HEADER_ROWS), -1):
        if any(num(grid.get(r, {}).get(c)) for c in cols):
            break
        out.append(r)
    return out[::-1]


def sections(block: Block) -> list[Block]:
    """A block split where a heading follows a total row ("Total of financial assets", then "Current financial
    liabilities"): each part can be another table. The columns are shared."""
    parts: list[list[BlockRow]] = [[]]
    prev_total = False
    for r in block.rows:
        if r.heading and prev_total and any(x.values for x in parts[-1]):
            parts.append([])
        parts[-1].append(r)
        if r.values:
            prev_total = bool(_TOTAL.match(r.label))
    return [Block(block.sheet, rows[0].r, rows[-1].r, block.c1, block.c2, block.columns, rows) for rows in parts if any(x.values for x in rows)]


def label_col_of(grid: dict, rows: list[BlockRow], first_value_col: int) -> int:
    cs = [c for x in rows for c, v in grid.get(x.r, {}).items() if c < first_value_col and isinstance(v, str) and str(v).strip()]
    return min(cs) if cs else first_value_col


def _overlap(grid: dict, r1: int, r2: int, num) -> float:
    a = {c for c, v in grid[r1].items() if num(v)}
    b = {c for c, v in grid[r2].items() if num(v)}
    return len(a & b) / max(1, min(len(a), len(b)))


PERIOD_WORDS = frozenset({"march", "april", "year", "period", "ended", "end", "st", "th", "particulars", "amount", "rs", "lakh", "lakhs"})


def header_words(text: str) -> frozenset[str]:
    """A column header's words without its year ("Holding Company 2025-26" → parent)."""
    return text_tokens(_FY.sub(" ", re.sub(r"\d", " ", text))) - PERIOD_WORDS


def _only_period(text: str, cy_end: dt.date, py_end: dt.date | None) -> bool:
    """A header that only says which year ("As at 31 March 2026", "2025-26")."""
    stripped = _FY.sub(" ", re.sub(r"\d", " ", text))
    return not header_words(text) and (_scope_of(text, cy_end, py_end) is not None or not text_tokens(stripped))


# ------------------------------------------------------------------ block → table
@dataclass
class CellSuggestion:
    ref: str
    concept: str
    scope: str
    preferred_label: str | None
    dims: list[dict]
    confidence: float
    r: int = -1  # the sheet row and column (0-based)
    c: int = -1
    # the same figure reported again (table_also.py): [{concept, preferredLabel, dims}]
    also: list[dict] = field(default_factory=list)

    def to_json(self) -> dict:
        out = {"ref": self.ref, "concept": self.concept, "scope": self.scope, "preferredLabel": self.preferred_label, "dims": self.dims, "confidence": round(self.confidence, 3)}
        return {**out, "also": self.also} if self.also else out


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
            "cells": [c.to_json() for c in self.cells],
        }


def _exact_member(axes: list[TableAxis], text: frozenset[str]) -> tuple[TableAxis, TableMember] | None:
    """The member of another axis a row label names exactly (its own words, or all its words)."""
    for a in axes:
        for m in a.members:
            if m.usable and not m.is_default and text and (text == a.own(m) or text == m.tokens):
                return a, m
    return None


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
    data_rows = [r for r in block.rows if r.values and r.label and any(r.values.values())]
    labels = [text_tokens(r.label) for r in data_rows]
    dated = [bool(_BALANCE.search(r.label) and header_dates(r.label)) for r in data_rows]
    best = None
    for t in catalog.tables:
        if not t.items:
            continue
        for ax in t.axes:
            if ax.typed:
                continue
            picks = [best_member(ax, h) for h in headers]
            # two columns of one year can't be the same member ("<12 months" and ">12 months")
            named = [m.member for m, s in picks if m is not None and s >= MIN_MATCH]
            if len(named) != len(set(named)) and not _years_differ(block) and not _repeats(named):
                continue
            col = sum(s for _, s in picks) / max(1, len(picks))
            if col < MIN_MATCH * 0.8:
                continue
            others = [a for a in t.axes if a.axis != ax.axis and not a.typed]
            # rows that are members: once one row names a member of an axis whose numbered placeholders the columns
            # name ("Other financial assets at amortised cost, class N" under "at amortised cost"), the other rows can
            # take those placeholders
            col_own = {w for (m, sc) in picks if m is not None and sc >= MIN_MATCH for w in ax.own(m)}
            exact = [hit for lab in labels if (hit := _exact_member(others, lab))]
            placeholders = any(_family_for(a, col_own) for a, _ in exact)
            row_scores = []
            balance = t.balance_concept
            for lab, is_balance in zip(labels, dated, strict=True):
                if balance and is_balance:
                    row_scores.append(0.9)  # "Balance as at 31 March 2025": the table's balance, by its date
                    continue
                item = _best_item(t, lab, False)[1]
                member = max((best_member(a, lab)[1] for a in others), default=0.0)
                if _exact_member(others, lab):
                    member = 1.0
                elif placeholders:
                    member = max(member, 0.65)
                row_scores.append(max(item, member * 0.9))
            row = sum(row_scores) / max(1, len(row_scores))
            if row < MIN_MATCH * 0.8:
                continue
            score = 0.55 * col + 0.45 * row
            if best is None or score > best[2]:
                best = (t, ax, score)
    return best if best and best[2] >= MIN_TABLE_SCORE else None


def _repeats(named: list[str]) -> bool:
    """The same members again, in the same order: one group of columns per year ("FVTPL, FVTOCI, amortised cost" under
    each year's header)."""
    n = len(named)  # a group of 2+ different members: one member twice is two columns that can't both be it
    return any(n % k == 0 and n // k >= 2 and len(set(named[:k])) == k and named == named[:k] * (n // k) for k in range(2, n // 2 + 1))


def _years_differ(block: Block) -> bool:
    return len({c.scope for c in block.columns if c.scope}) > 1


def assign(block: Block, t: TableInfo, col_axis: TableAxis, score: float, cy_end: dt.date, py_end: dt.date | None,
           figures: Figures = NO_FIGURES) -> TableBlockSuggestion | None:
    others = [a for a in t.axes if a.axis != col_axis.axis and not a.typed]
    cols: list[dict] = []
    col_member: dict[int, tuple[dict | None, float]] = {}
    col_own: set[str] = set()  # the column members' own words (which numbered family the rows take)
    for c in block.columns:
        if not c.header:
            continue
        if not any(r.values.get(c.c) for r in block.rows):
            continue  # only zeros: zeros come from the rules, not from Excel (ADR-0013)
        scope = figures.scope_of(block, c.c) or c.scope
        if c.total:
            # the class total: the column axis at its default (no member); MCA filings report it with the row's members
            col_member[c.c] = (None, 0.8)
            cols.append({"c": c.c, "members": [], **({"scope": scope} if scope else {})})
            continue
        m, s = best_member(col_axis, text_tokens(c.header))
        if m is None or s < MIN_MATCH:
            continue
        dim = None if m.is_default else {"axis": col_axis.axis, "member": m.member}
        col_member[c.c] = (dim, s)
        col_own |= col_axis.own(m)
        cols.append({"c": c.c, "members": [dim] if dim else [], **({"scope": scope} if scope else {})})
    if not cols:
        return None
    member_rows = _member_rows(block, t, others, col_own)
    if member_rows is not None:
        return block_suggestion(block, t, score, member_rows, cols, col_member)
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
            m, s = best_member(a, lab)
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
    return block_suggestion(block, t, score, rows, cols, col_member)


def block_suggestion(block: Block, t: TableInfo, score: float, rows: list[dict], cols: list[dict], col_member: dict) -> TableBlockSuggestion | None:
    """The suggestion of a block's row and column assignment, with each cell's planned fact. A row's `cols`, when
    given, are the only columns it reports (a party's figures sit under its own category)."""
    if not rows:
        return None
    cells: list[CellSuggestion] = []
    by_r = {r.r: r for r in block.rows}
    for row in rows:
        for c in cols:
            if "cols" in row and c["c"] not in row["cols"]:
                continue
            v = by_r[row["r"]].values.get(c["c"])
            scope = row.get("scope") or c.get("scope")
            if v is None or not scope:
                continue
            dim, cs = col_member[c["c"]]
            dims = [d for d in (*row["members"], dim) if d]
            if not dims:
                continue  # no member at all: a statement-level figure (the statement tagger's)
            cells.append(CellSuggestion(a1(row["r"], c["c"]), row["concept"], scope, row["preferredLabel"], dims, round(score * min(cs, row["_s"]), 3), row["r"], c["c"]))
    if not cells:
        return None
    for row in rows:
        row.pop("_s")
    rng = f"{a1(block.r1, block.c1)}:{a1(block.r2, block.c2)}"
    return TableBlockSuggestion(block.sheet, rng, t.id, t.title, score, rows, cols, cells)


def _member_rows(block: Block, t: TableInfo, others: list[TableAxis], col_own: set[str]) -> list[dict] | None:
    """Rows that are members of another axis (financial assets by class: Trade receivables, Loans, Cash …), or None
    when the block's rows are line items. A row naming a member exactly takes it; the other rows with figures take the
    next numbered placeholder ("Other financial assets at amortised cost, class 1 …") of the family the columns'
    members name, in row order; a total row is the line item over the column members alone. Rows of zeros give
    nothing. The line item is the one the section heading names (else the table's first)."""
    data = [r for r in block.rows if r.values and r.label and not _TOTAL.match(r.label)]
    named = {r.r: _exact_member(others, text_tokens(r.label)) for r in data}
    hits = [x for x in named.values() if x]
    if not hits:
        return None
    axis = hits[0][0]
    family = _family_for(axis, col_own)
    used = {m.member for _, m in hits}
    free = [m for m in family if m.member not in used]
    items = [i for i in t.items if i.preferred_label != "periodStartLabel"]
    rows: list[dict] = []
    heading = ""
    for r in block.rows:
        if r.heading:
            heading = r.label
            continue
        if not any(r.values.values()):
            continue
        best, s = _best_item(t, text_tokens(heading), False) if heading else (None, 0.0)
        item = best if best is not None and s >= MIN_MATCH else (items[0] if items else None)
        if item is None:
            continue
        hit = named.get(r.r)
        if _TOTAL.match(r.label):
            continue  # the class total: the parent members, which the roll-ups derive from the rows (engine)
        if hit and hit[0].axis == axis.axis:
            members, conf = [{"axis": axis.axis, "member": hit[1].member}], 0.9
        elif free:
            members, conf = [{"axis": axis.axis, "member": free.pop(0).member}], 0.6
        else:
            continue
        rows.append({"r": r.r, "concept": item.concept, "preferredLabel": item.preferred_label, "members": members, "_s": conf})
    return rows


def _family_for(axis: TableAxis, col_own: set[str]) -> list[TableMember]:
    """The numbered placeholders of the axis that the columns' members name (shared own words), best first."""
    fams = [(len(axis.own(ms[0]) & col_own), ms) for ms in axis.numbered_families().values()]
    fams = [x for x in fams if x[0] > 0]
    return max(fams, key=lambda x: (x[0], -len(x[1][0].member)))[1] if fams else []


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


@dataclass(frozen=True)
class TableContext:
    """What a table producer may read besides the block: the taxonomy's tables, the filing's year ends, and the main
    statements' figures (column years)."""
    catalog: TableCatalog
    cy_end: dt.date
    py_end: dt.date | None
    figures: Figures = NO_FIGURES


def note_table(block: Block, ctx: TableContext) -> TableBlockSuggestion | None:
    """A note table whose rows are line items (or members) and whose columns are members: PPE, changes in equity,
    financial assets by category."""
    m = match_block(block, ctx.catalog)
    return assign(block, m[0], m[1], m[2], ctx.cy_end, ctx.py_end, ctx.figures) if m else None
