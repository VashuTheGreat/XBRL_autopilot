"""Layout analysis of one sheet: which columns hold the current and previous year, and which rows are taggable.

Works on the WorkbookModel cells the desktop app already has (`{r, c, v}`, 0-based). Nothing is taxonomy-specific.
- Period columns come from header cells whose dates are the filing's CY/PY end dates. A later header row (e.g. the
  next note's header) can move them; a header naming another date (a stale "30th September 2019") is ignored.
- A row's label is its leftmost text left of the value columns. Rows without values are headings and give context
  ("CURRENT ASSETS" › "Financial Assets"). "TOTAL ASSETS" names itself; a bare "Total" row or an unlabelled subtotal
  takes its heading's name.
- A heading's scope ends at a row further left, at a sibling (another heading at its column, or a line with its own
  note number), at a blank row once it has had lines, or at its total. A signature block ends the statement.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from src.services.tagging.text import clean_label, header_dates, norm_label, scale_of

SHEET_KINDS = ("balance_sheet", "profit_loss", "cash_flow", "equity", "notes", "other")
# row markers, not labels: "IV", "(a)", "(I+II)", "(A+B+C)", "(VII-VIII)"
_MARK = re.compile(r"\(?[ivxlcdmIVXLCDMa-eA-E0-9 +\-=*/.]{1,12}\)?")
_NOTE_TITLE = re.compile(r"^\s*note\s*(?:no\.?)?\s*\d+", re.I)
_TOTAL = re.compile(r"^\s*(?:sub[\s-]?)?total\b", re.I)
_NOTE_HEADER = re.compile(r"^\s*note\b", re.I)
_QUALIFIER_ONLY = re.compile(r"^\s*\([^)]*\)\s*:?\s*$")
# the end of a statement: the auditor's and directors' signature block
_SIGNATURE = re.compile(
    r"^\s*(?:as per our report|for and on behalf|the (?:accompanying )?notes (?:are|form)|chartered accountants|"
    r"firm'?s? registration|membership no|din\b|partner\b|director\b|place\s*:|date\s*:)",
    re.I,
)


def col_letter(c: int) -> str:
    s = ""
    c += 1
    while c:
        c, rem = divmod(c - 1, 26)
        s = chr(65 + rem) + s
    return s


def a1(r: int, c: int) -> str:
    return f"{col_letter(c)}{r + 1}"


@dataclass
class TagRow:
    sheet: str
    r: int  # 0-based row
    label: str  # cleaned label used for matching (a bare "Total" row carries its heading's name)
    raw_label: str | None  # the text in the sheet ("Total", or None for an unlabelled subtotal)
    context: list[str]  # headings above, outermost first
    is_total: bool
    cells: dict[str, str] = field(default_factory=dict)  # scope → A1
    values: dict[str, float] = field(default_factory=dict)
    label_ref: str | None = None  # A1 of the label cell
    period_type: str | None = None  # "instant" under an "As at" header, "duration" under "Year ended"; else unknown


@dataclass
class SheetLayout:
    sheet: str
    kind: str
    scale: str | None
    period_columns: dict[str, str]  # scope → column letter (the first header found)
    rows: list[TagRow]
    note: str | None = None  # why nothing was found


def sheet_kind(name: str, top_text: str) -> str:
    t = f"{name} {top_text}".lower().replace("&", " and ")
    if "balance sheet" in t or re.search(r"\bbs\b", t):
        return "notes" if re.search(r"\bnotes?\b", name.lower()) else "balance_sheet"
    if "cash flow" in t:
        return "cash_flow"
    if "changes in equity" in t or re.search(r"\bchange in equity\b", t):
        return "equity"
    if "profit and loss" in t or "p and l" in t or "income and expenditure" in t:
        return "notes" if re.search(r"\bnotes?\b", name.lower()) else "profit_loss"
    if re.search(r"\bnotes?\b", t):
        return "notes"
    return "other"


def _is_text_label(v) -> bool:
    if not isinstance(v, str):
        return False
    s = v.strip()
    if _TOTAL.match(s):
        return True
    return len(re.findall(r"[A-Za-z]", s)) >= 3 and not _MARK.fullmatch(s)


def _has_words_after_total(raw: str) -> bool:
    """"TOTAL ASSETS", "Total comprehensive income" name themselves; "Total", "Total (A+B)", "Sub-total" don't."""
    rest = re.sub(r"\([^)]*\)", " ", _TOTAL.sub("", raw, count=1))  # "Total (unsecured, considered good)"
    return bool(re.search(r"[A-Za-z]{3,}", rest))


def _looks_like_heading(label: str) -> bool:
    return len(re.findall(r"[A-Za-z]", label)) >= 3 and not re.match(r"^(?:din|cin|pan)\b", label, re.I)


def _period_columns(row: dict[int, object], cy_end: dt.date, py_end: dt.date | None) -> dict[str, int]:
    found: dict[str, int] = {}
    for c, v in sorted(row.items()):
        if not isinstance(v, str) or len(v) > 80:
            continue
        for d in header_dates(v):
            if d == cy_end and "CY" not in found:
                found["CY"] = c
            elif py_end and d == py_end and "PY" not in found:
                found["PY"] = c
    if "CY" not in found or (py_end and "PY" not in found) or len(set(found.values())) != len(found):
        return {}
    return found


_INSTANT_HEADER = re.compile(r"\bas\s+(?:at|on)\b", re.I)
_DURATION_HEADER = re.compile(r"\b(?:year|period|months?)\s+ended\b|\bfor\s+the\s+(?:year|period)\b", re.I)


def _header_period_type(rows: list[dict[int, object]], cols: dict[str, int]) -> str | None:
    """"As at 31st March 2026" → instant, "For the year ended …" → duration (the header may span two rows)."""
    text = " ".join(str(row.get(c, "")) for row in rows for c in cols.values())
    if _INSTANT_HEADER.search(text):
        return "instant"
    if _DURATION_HEADER.search(text):
        return "duration"
    return None


def _note_column(rows: list[dict[int, object]], before: int) -> int | None:
    """The "Note No." column named in the header rows (left of the first value column)."""
    for row in rows:
        for c, v in sorted(row.items()):
            if c < before and isinstance(v, str) and _NOTE_HEADER.match(v) and not _NOTE_TITLE.match(v):
                return c
    return None


@dataclass
class _Heading:
    label: str
    col: int
    has_note: bool
    used: bool = False


class _Context:
    """The headings above the current row: one ALL-CAPS section, a note title, and a stack of sub-headings."""

    def __init__(self) -> None:
        self.section: str | None = None
        self.section_in_note = False  # an ALL-CAPS heading inside a note ends with that note
        self.section_fresh = False  # nothing under the section yet: a note title right after it belongs to it
        self.note_title: str | None = None
        self.stack: list[_Heading] = []

    def reset(self) -> None:
        self.section, self.note_title, self.stack = None, None, []
        self.section_in_note = self.section_fresh = False

    def new_note(self, title: str) -> None:
        if self.section_fresh:
            self.section_in_note = False  # "CURRENT ASSETS" then "NOTE 9 : TRADE RECEIVABLES": a sheet section
        elif self.section_in_note:
            self.section, self.section_in_note = None, False
        self.note_title, self.stack, self.section_fresh = title, [], False

    def new_section(self, label: str) -> None:
        self.section, self.section_in_note, self.stack = label, self.note_title is not None, []
        self.section_fresh = True

    def close_for(self, col: int, has_note: bool, heading: bool) -> None:
        """Close the sub-headings a row at `col` is not under: those to its right, and a sibling at its column."""
        while self.stack:
            top = self.stack[-1]
            if top.col > col or (top.col == col and (heading or has_note)):
                self.stack.pop()
            else:
                break

    def blank(self) -> None:
        """A blank row ends a plain heading that has had lines; a heading with a note number ends at its sibling."""
        while self.stack and self.stack[-1].used and not self.stack[-1].has_note:
            self.stack.pop()

    def innermost_used(self) -> str | None:
        return next((h.label for h in reversed(self.stack) if h.used), None)

    def labels(self) -> list[str]:
        return [h.label for h in self.stack]


def analyse_sheet(sheet: dict, cy_end: dt.date, py_end: dt.date | None) -> SheetLayout:
    name = sheet["name"]
    grid: dict[int, dict[int, object]] = {}
    for cell in sheet["cells"]:
        grid.setdefault(cell["r"], {})[cell["c"]] = cell["v"]
    top_text = " ".join(str(v) for r in sorted(grid)[:12] for v in grid[r].values() if isinstance(v, str))
    kind = sheet_kind(name, top_text)
    scale = next((s for r in sorted(grid)[:15] for v in grid[r].values() if isinstance(v, str) and (s := scale_of(v))), None)

    cols: dict[str, int] = {}
    first_cols: dict[str, int] = {}
    note_col: int | None = None
    period_type: str | None = None
    rows: list[TagRow] = []
    ctx = _Context()
    ended = False  # past a signature block: nothing is taggable until the next column header
    above: list[dict[int, object]] = []  # the rows just above a header, where "Note No." may sit

    for r in range(min(grid, default=0), max(grid, default=-1) + 1):
        row = grid.get(r, {})
        header = _period_columns(row, cy_end, py_end)
        if header:
            cols = header
            first_cols = first_cols or header
            note_col = _note_column([*above[-2:], row], min(header.values()))
            period_type = _header_period_type([*above[-1:], row], header)
            ctx.stack, ended, above = [], False, []
            continue
        above.append(row)
        if not cols:
            continue
        first_value_col = min(cols.values())
        texts = [(c, v) for c, v in sorted(row.items()) if c < first_value_col and _is_text_label(v)]
        raw = str(texts[0][1]).strip() if texts else None
        label_col = texts[0][0] if texts else first_value_col
        has_note = note_col is not None and row.get(note_col) not in (None, "")
        values = {
            scope: float(row[c])
            for scope, c in cols.items()
            if isinstance(row.get(c), (int, float)) and not isinstance(row.get(c), bool)
        }

        if raw and _SIGNATURE.match(raw):
            ended = True
            ctx.reset()
            continue
        if ended:
            continue
        if not values:
            if not raw:
                ctx.blank()
                continue
            label = clean_label(raw)
            if not _looks_like_heading(label) or _QUALIFIER_ONLY.match(raw):
                continue  # "(Unsecured, considered good)" qualifies the lines, it doesn't name them
            if _NOTE_TITLE.match(raw):
                ctx.new_note(label.title() if label.isupper() else label)
            elif label.isupper() and len(label) > 3:
                ctx.new_section(label)
            else:
                ctx.section_fresh = False
                ctx.close_for(label_col, has_note, heading=True)
                ctx.stack.append(_Heading(label=label, col=label_col, has_note=has_note))
            continue

        ctx.section_fresh = False
        note_ctx = ctx.note_title if kind == "notes" else None
        total_word = bool(raw and _TOTAL.match(raw))
        is_total = raw is None or total_word
        if raw is None:
            # an unlabelled row: a subtotal of the section above (it has every period)
            if len(values) < len(cols):
                continue
            heading = note_ctx or ctx.section
            if not heading:
                continue
            label = heading if note_ctx else f"Total {heading.lower()}"
            context = [h for h in (ctx.section, note_ctx) if h]
            ctx.stack = []
        elif total_word and not _has_words_after_total(raw):
            # "Total", "Total (A)": in a note, the note's total; in a statement, the total of the innermost heading
            # that had lines, else of the section
            inner = None if note_ctx else ctx.innermost_used()
            heading = inner or note_ctx or ctx.section
            if not heading:
                continue
            label = heading if (not inner and note_ctx) else f"Total {heading.lower()}"
            if ctx.stack and ctx.stack[-1].used:
                ctx.stack.pop()
            context = [h for h in (ctx.section, *ctx.labels(), note_ctx) if h]
        else:
            ctx.close_for(label_col, has_note, heading=False)
            label = clean_label(raw)
            # "TOTAL ASSETS" names itself: the heading above it is not its context
            context = [] if total_word else [h for h in (ctx.section, *ctx.labels(), note_ctx) if h]
            for h in ctx.stack:
                h.used = True
            if total_word and ctx.stack:
                ctx.stack.pop()  # "Total trade payables" closes "Trade payables"
        if not norm_label(label):
            continue
        rows.append(TagRow(
            sheet=name, r=r, label=label, raw_label=raw, context=context, is_total=is_total,
            cells={scope: a1(r, cols[scope]) for scope in values}, values=values,
            label_ref=a1(r, label_col) if raw else None, period_type=period_type,
        ))
    note = None if first_cols else "No column header names the filing's period ends"
    return SheetLayout(
        sheet=name, kind=kind, scale=scale, period_columns={s: col_letter(c) for s, c in first_cols.items()}, rows=rows, note=note,
    )
