"""Reads an MCA business-rule workbook into row records that keep the exact source text and location.

Port of ``engine/compiler/rules-source.mjs``. Cells are read as text the way SheetJS formats them
(``raw: false``): whole numbers without ``.0``, booleans as ``TRUE`` / ``FALSE``, line breaks as spaces.
``line`` counts from the first row of the sheet's stored range (see :mod:`sheet_origin`), so rule ids stay stable.
"""
from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field
from pathlib import Path

from python_calamine import CalamineWorkbook

from src.services.engine_rules.jsre import ji, js, trim
from src.services.engine_rules.sheet_origin import sheet_origins


@dataclass
class Row:
    line: int
    cells: list[str]

    def cell(self, i: int) -> str:
        """``r.cells[i] || ''``."""
        return self.cells[i] if i < len(self.cells) else ""


@dataclass
class Sheet:
    name: str
    rows: list[Row]
    truncated: bool = False
    truncation_note: str | None = None


@dataclass
class Workbook:
    file: Path
    form: str
    sheets: list[Sheet] = field(default_factory=list)

    def sheet(self, name: str) -> Sheet | None:
        return next((s for s in self.sheets if s.name == name), None)


_NEWLINE = re.compile(r"\r?\n")


def _text(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, (_dt.date, _dt.datetime, _dt.time, _dt.timedelta)):
        return v.isoformat() if hasattr(v, "isoformat") else str(v)
    return str(v)


def read_workbook(path: Path) -> Workbook:
    origins = sheet_origins(path)
    book = CalamineWorkbook.from_path(str(path))
    sheets: list[Sheet] = []
    for name in book.sheet_names:
        r0, c0 = origins.get(name, (0, 0))
        grid = book.get_sheet_by_name(name).to_python(skip_empty_area=False)
        rows: list[Row] = []
        for i, raw in enumerate(grid[r0:]):
            cells = [_NEWLINE.sub(" ", _text(x)) for x in raw[c0:]]
            if all(trim(c) == "" for c in cells):
                continue
            rows.append(Row(line=i + 1, cells=cells))
        sheets.append(Sheet(name=trim(name), rows=rows))
    return Workbook(file=path, form="workbook", sheets=sheets)


# ------------------------------------------------------------------------------------------------- C&I layout
@dataclass
class Elr:
    code: str
    title: str


@dataclass
class SpecificRow:
    sheet: str
    line: int
    elr: Elr | None
    element: str
    text: str
    # Ind AS layout only
    prefix: str | None = None
    fta: str | None = None


@dataclass
class SpecificRules:
    rows: list[SpecificRow]
    truncated: bool
    truncation_note: str | None
    last_elr: Elr | None


_ELR_HEAD = js(r"^\[(\d{6}[a-z]?)\]\s*(.*)$")


def specific_rules(wb: Workbook) -> SpecificRules:
    """C&I: ELR header rows ``[nnnnnn] Title``, then ``element | rule`` rows."""
    sheet = wb.sheet("Specific rules for elements")
    out: list[SpecificRow] = []
    elr: Elr | None = None
    for r in sheet.rows:
        a, b = r.cell(0), r.cell(1)
        h = _ELR_HEAD.match(trim(a))
        if h:
            elr = Elr(h.group(1), trim(h.group(2)))
            continue
        if not b or not trim(b) or a == "ELR/ Element Name":
            continue
        out.append(SpecificRow(sheet.name, r.line, elr, trim(a), trim(b)))
    return SpecificRules(out, sheet.truncated, sheet.truncation_note, elr)


_ELR_DEFINITION = js(r"^\[(\d{6}[a-z]?)\]\s*(.*)$")
_IND_AS_PREFIXES = ("ind-as", "in-ca")


def specific_rules_ind_as(wb: Workbook) -> SpecificRules:
    """Ind AS: ``LinkRole`` / ``Definition [nnnnnn] Title`` blocks, then rows
    ``prefix | name | label | order | a | Business Rule | (rule, rarely) | Status | Applicable for First Time Adoption``."""
    sheet = wb.sheet("Specific rules for elements")
    out: list[SpecificRow] = []
    elr: Elr | None = None
    for r in sheet.rows:
        head = trim(r.cell(0))
        if head == "Definition":
            h = _ELR_DEFINITION.match(trim(r.cell(1)))
            elr = Elr(h.group(1), trim(h.group(2))) if h else None
            continue
        if head not in _IND_AS_PREFIXES:
            continue
        text = trim(" ".join(t for t in (trim(r.cell(5)), trim(r.cell(6))) if t))
        if not text or text == "No Rules Defined":
            continue
        out.append(SpecificRow(sheet.name, r.line, elr, trim(r.cell(1)), text, prefix=head, fta=trim(r.cell(7)) or None))
    return SpecificRules(out, sheet.truncated, sheet.truncation_note, elr)


def opening_closing_formulas(wb: Workbook) -> list[dict]:
    """Ind AS "formulas Linkbase": triples (opening balance, change, closing balance) separated by blank rows; the
    opening and closing rows name the same balance element (period start / end label)."""
    sheet = wb.sheet("formulas Linkbase")
    if sheet is None:
        return []
    out: list[dict] = []
    group: list[Row] = []

    def flush() -> None:
        qnames = [f"{trim(g.cell(0))}:{trim(g.cell(1))}" for g in group]
        twice = [q for q in dict.fromkeys(qnames) if qnames.count(q) == 2]
        once = [q for q in qnames if qnames.count(q) == 1]
        # the balance element is named twice (opening and closing label), the change once; row order varies
        if len(group) == 3 and len(twice) == 1 and len(once) == 1:
            out.append({"line": group[0].line, "balance": twice[0], "change": once[0]})
        elif group:
            out.append({"line": group[0].line, "unparsed": [trim(g.cell(1)) for g in group]})
        group.clear()

    prev_line = None
    for r in sheet.rows:
        if trim(r.cell(0)) not in _IND_AS_PREFIXES:
            continue
        if prev_line is not None and r.line != prev_line + 1:
            flush()
        group.append(r)
        prev_line = r.line
    flush()
    return out


_DIGITS = js(r"^\d+$")


def generic_rules(wb: Workbook) -> list[dict]:
    sheet = wb.sheet("Generic rules")
    return [
        {"sheet": sheet.name, "line": r.line, "no": int(r.cell(0)), "text": trim(r.cell(1))}
        for r in sheet.rows
        if _DIGITS.search(r.cell(0))
    ]


def change_rules(wb: Workbook) -> list[dict]:
    sheet = wb.sheet("Changes to Business Rules")
    if sheet is None:
        return []
    return [
        {
            "sheet": sheet.name, "line": r.line, "no": int(r.cell(0)), "tab": r.cell(2),
            "element": trim(r.cell(3)), "text": trim(r.cell(4)),
        }
        for r in sheet.rows
        if _DIGITS.search(r.cell(0))
    ]


_ML_SHEET = ji(r"^Mandatory line.items$")


def mandatory_line_item_sheets(wb: Workbook) -> list[dict]:
    return [
        {
            "sheet": s.name,
            "rows": [
                {"line": r.line, "no": int(r.cell(0)), "table": trim(r.cell(1)), "text": trim(r.cell(2))}
                for r in s.rows
                if _DIGITS.search(r.cell(0))
            ],
        }
        for s in wb.sheets
        if _ML_SHEET.search(s.name)
    ]


_EX_PARENT = ji(r"^Exempt parent member.?.?Dimension$")
_EX_CHILD = ji(r"^Exempt Child member.?.?Dimension$")
_TABLE_HEAD = ji(r"^Name of Table$")
_IN_FOLLOWING = ji(r"^In following cases")


def exempt_member_sheets(wb: Workbook, kind: str) -> list[dict]:
    """Rows ``Table | Axis | Member``; a blank table/axis cell means "same as the previous row"."""
    rx = _EX_PARENT if kind == "parent" else _EX_CHILD
    out = []
    for s in wb.sheets:
        if not rx.search(js(r"\s+").sub(" ", s.name)):
            continue
        # the Ind AS sheets have a leading S.No column: the table is the column headed "Name of Table"
        off = next((i for r in s.rows for i, c in enumerate(r.cells[:3]) if _TABLE_HEAD.search(trim(c))), 0)
        table = axis = None
        rows = []
        for r in s.rows:
            t, a, m = (trim(r.cell(off + i)) for i in range(3))
            if _TABLE_HEAD.search(t) or _IN_FOLLOWING.search(t):
                continue
            if t:
                table = t
            if a:
                axis = a
            if m:
                rows.append({"line": r.line, "table": table, "axis": axis, "member": m})
        out.append({"sheet": s.name, "truncated": s.truncated, "rows": rows})
    return out


_PCE_SHEET = ji(r"^Parent.child exempt.calculation$")
_ABSTRACT_HEAD = ji(r"^Abstract's name$")


def parent_child_exempt_sheets(wb: Workbook) -> list[dict]:
    return [
        {
            "sheet": s.name,
            "rows": [
                {"line": r.line, "abstract": trim(r.cell(0)), "text": trim(r.cell(1))}
                for r in s.rows
                if r.cell(0) and not _ABSTRACT_HEAD.search(trim(r.cell(0)))
            ],
        }
        for s in wb.sheets
        if _PCE_SHEET.search(js(r"\s+").sub(" ", s.name))
    ]


_COUNTRY_SHEET = ji(r"^Country Codes?$")
_COUNTRY_HEAD = ji(r"^Country Name$")


def country_names(wb: Workbook) -> list[str]:
    names: set[str] = set()
    for s in wb.sheets:
        if not _COUNTRY_SHEET.search(s.name):
            continue
        for r in s.rows:
            for c in r.cells:
                v = trim(c)
                if v and not _COUNTRY_HEAD.search(v):
                    names.add(v)
    return sorted(names)


_ELR_CODE = js(r"^\[(\d{6}[a-zA-Z]?)\]")


def applicable_elrs(wb: Workbook) -> list[dict]:
    sheet = wb.sheet("Applicable ELR")
    out = []
    for r in sheet.rows:
        if not _DIGITS.search(r.cell(0)):
            continue
        m = _ELR_CODE.search(trim(r.cell(2)))
        out.append({
            "line": r.line, "id": trim(r.cell(1)), "name": trim(r.cell(2)),
            "code": m.group(1) if m else None, "applicableTo": trim(r.cell(3)),
        })
    return out
