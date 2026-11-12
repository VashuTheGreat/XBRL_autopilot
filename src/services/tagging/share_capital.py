"""Share capital notes (ADR-0013): the share-class facts of a company with one class of shares, many of them written in
the note's text, not in cells.

    AUTHORISED
    10,00,000 (March 31, 2025 : 10,00,000) Equity Shares of Rs. 10/- each        100.00      100.00
    ISSUED, SUBSCRIBED AND PAID-UP
    10,00,000 (March 31, 2025 : 10,00,000) Equity Shares of Rs. 10/- each        100.00      100.00
    a) Reconciliation of equity shares
    Balance as at the beginning of the year                                   10,00,000   10,00,000
    Balance as at the end of the year                                         10,00,000   10,00,000
    c) Details of shares held by shareholders holding more than 5% …
    Dixon Technologies (India) Limited                                        10,00,000   10,00,000
    In %                                                                           1.00        1.00

From such a note, under the class member of the table with one numbered classes axis (Equity shares 1):
- a **count line** (a text with its counts: `pick` = which number, text.numbers_in_text) gives the share counts its
  heading names ("ISSUED, SUBSCRIBED AND PAID-UP" → issued, subscribed, subscribed and fully paid, paid-up), CY and PY,
  and the par value ("of Rs. 10/- each"); its amount cells give the values of shares the heading names;
- the **reconciliation** gives the shares outstanding: the PY opening and both closings (the CY opening is the PY closing);
- the **holders over 5%** give each holder's shares and percentage (numbered holder members).

Line items and members come from labels (heading words ⊇ the item's own words), never codes. Only one class: a note that
names preference shares is left alone.
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from src.services.tagging.layout import SheetLayout, TagRow
from src.services.tagging.table_catalog import TableAxis, TableCatalog, TableInfo, TableItem, TableMember, text_tokens
from src.services.tagging.text import header_dates, numbers_in_text

CONFIDENCE = 0.85
_NUMBERED_FIRST = re.compile(r"^[A-Za-z]+?1Member$")
_PAR = re.compile(r"(?:rs\.?|₹|inr)\s*([\d.,]+)\s*(?:/-)?\s*(?:each|per\s+share)", re.I)
_OVER_5 = re.compile(r"more\s+than\s+5\s*%|5\s*%\s+(?:or\s+more|and\s+above)", re.I)
_PERCENT_ROW = re.compile(r"^\s*(?:in\s*)?%|percent", re.I)
_OPENING = re.compile(r"\b(?:beginning|opening)\b", re.I)
_CLOSING = re.compile(r"\b(?:end|closing)\b", re.I)
_OTHER_CLASS = re.compile(r"\bpreference\b", re.I)
COUNT_WORDS = frozenset({"number", "share"})
VALUE_WORDS = frozenset({"value", "share"})


@dataclass
class ShareNote:
    """The share-capital note's suggestions, and every cell of the note it reads (the statement tagger's guesses on
    them are dropped: "Add: Shares issued during the year" is a count, not the value of shares issued)."""
    suggestions: list[dict]
    cells: set[tuple[str, str]]


@dataclass(frozen=True)
class ShareClass:
    table: TableInfo
    axis: TableAxis
    member: TableMember

    @property
    def dim(self) -> dict:
        return {"axis": self.axis.axis, "member": self.member.member}


def share_capital_suggestions(tables: TableCatalog, sheets: list[dict], layouts: list[SheetLayout], py_end: dt.date | None) -> ShareNote:
    note = ShareNote([], set())
    one = _classes_table(tables)
    if one is None:
        return note
    for sheet, layout in zip(sheets, layouts, strict=True):
        if layout.kind != "notes":
            continue
        lines = _lines(sheet)
        if any(_OTHER_CLASS.search(t) for t in lines.values()):
            continue  # more than one class: the user maps it
        note.suggestions += _count_lines(one, layout, lines, py_end)
        note.suggestions += _reconciliation(one, layout)
        note.suggestions += _holders(tables, one, layout, lines)
        note.cells |= {(row.sheet, ref) for row in layout.rows if _in_reconciliation(row) for ref in row.cells.values()}
    note.cells |= {(s["cell"]["sheet"], s["cell"]["ref"]) for s in note.suggestions if "pick" not in s}
    return note


def _in_reconciliation(row: TagRow) -> bool:
    return any("reconciliation" in text_tokens(h) for h in row.context)


def _classes_table(tables: TableCatalog) -> ShareClass | None:
    """The table with a single, numbered classes axis and the most share counts (classes of equity share capital)."""
    best: tuple[int, ShareClass] | None = None
    for t in tables.tables:
        if len(t.axes) != 1 or t.axes[0].typed:
            continue
        first = next((m for m in t.axes[0].members if m.usable and _NUMBERED_FIRST.match(m.member.split(":")[-1])), None)
        n = sum(1 for i in t.items if i.data_type == "xbrli:sharesItemType")
        if first is not None and n and (best is None or n > best[0]):
            best = (n, ShareClass(t, t.axes[0], first))
    return best[1] if best else None


def _lines(sheet: dict) -> dict[int, str]:
    texts: dict[int, list[tuple[int, str]]] = {}
    for c in sheet["cells"]:
        if isinstance(c["v"], str) and c["v"].strip():
            texts.setdefault(c["r"], []).append((c["c"], c["v"].strip()))
    return {r: " ".join(t for _, t in sorted(ts)) for r, ts in texts.items()}


def _named_by(words: frozenset[str], items: list[TableItem], drop: frozenset[str]) -> list[TableItem]:
    """The items a heading names: all their own words in it (one may be missing from three or more: "subscribed and fully
    paid" under "ISSUED, SUBSCRIBED AND PAID-UP")."""
    out = []
    for i in items:
        own = i.base - drop
        missing = own - words
        if own and (not missing or (len(own) >= 3 and len(missing) == 1)):
            out.append(i)
    return out


def _items(t: TableInfo, data_type: str, period: str) -> list[TableItem]:
    seen: dict[str, TableItem] = {}
    for i in t.items:
        if i.data_type == data_type and i.period_type == period and i.preferred_label != "periodStartLabel" and i.concept != t.balance_concept:
            seen.setdefault(i.concept, i)
    return list(seen.values())


def _suggestion(row: TagRow, ref: str, item: TableItem, also: list[TableItem], one: ShareClass, scope: str, why: str,
                pick: int | None = None, also_scopes: tuple[str, ...] = (), total: bool = True) -> dict:
    """One cell's suggestion under the class member, with its other line items as "also" facts. `total`: with one class,
    each fact is also the total over the classes (no member; Dixon files both)."""
    dims = [one.dim]
    role = lambda i: i.preferred_label if i.preferred_label == "periodStartLabel" else None  # noqa: E731
    extra = [{"concept": i.concept, "tableId": one.table.id, "preferredLabel": role(i), "dims": dims, "confidence": CONFIDENCE, "reason": why} for i in also]
    extra += [{"concept": item.concept, "tableId": one.table.id, "preferredLabel": role(item), "dims": dims, "scope": s, "confidence": CONFIDENCE, "reason": why}
              for s in also_scopes]
    if total:
        extra += [{"concept": i.concept, "preferredLabel": role(i), "dims": [], "confidence": CONFIDENCE, "reason": f"{why}, the only class"} for i in [item, *also]]
    return {
        "cell": {"sheet": row.sheet, "ref": ref}, "label": row.raw_label or row.label, "context": row.context, "sheetKind": "notes",
        "concept": item.concept, "conceptLabel": item.label, "scope": scope, "dims": dims, "tableId": one.table.id,
        "preferredLabel": item.preferred_label if item.preferred_label == "periodStartLabel" else None,
        **({"pick": pick} if pick is not None else {}), "sign": 1, "confidence": CONFIDENCE, "origin": "table",
        "rationale": f"Share capital note: {why}", "needsReview": False, "alternatives": [], **({"also": extra} if extra else {}),
    }


def _count_lines(one: ShareClass, layout: SheetLayout, lines: dict[int, str], py_end: dt.date | None) -> list[dict]:
    counts = _items(one.table, "xbrli:sharesItemType", "instant")
    values = _items(one.table, "xbrli:monetaryItemType", "instant")
    par = next((i for i in one.table.items if i.data_type == "num:perShareItemType" and {"par", "value"} <= i.base), None)
    out: list[dict] = []
    par_done = False
    for row in layout.rows:
        text = row.raw_label or ""
        nums = numbers_in_text(text)
        if len(nums) < 1 or "share" not in text_tokens(text) or not row.label_ref:
            continue
        heading = _heading_above(lines, row.r)
        words = text_tokens(heading)
        named = _named_by(words, counts, COUNT_WORDS)
        if not named:
            continue
        picks = [("CY", 0)] + ([("PY", 1)] if len(nums) >= 2 and py_end in header_dates(text) else [])
        for scope, k in picks:
            out.append(_suggestion(row, row.label_ref, named[0], named[1:], one, scope, heading.strip().lower(), pick=k))
        m = _PAR.search(text)
        if par is not None and m and not par_done and m.group(1).replace(",", "") == nums[-1] and len(nums) > len(picks):
            out.append(_suggestion(row, row.label_ref, par, [], one, "CY", "par value", pick=len(nums) - 1, also_scopes=("PY",) if py_end else (), total=False))
            par_done = True
        priced = _named_by(words, values, VALUE_WORDS)
        for scope, ref in row.cells.items():
            if priced and row.values.get(scope):
                out.append(_suggestion(row, ref, priced[0], priced[1:], one, scope, heading.strip().lower()))
    return out


def _heading_above(lines: dict[int, str], r: int) -> str:
    """The nearest text line above a row (within 3 rows) that states no figure: "AUTHORISED"."""
    for x in range(r - 1, r - 4, -1):
        t = lines.get(x)
        if t and not numbers_in_text(t):
            return t
    return ""


def _reconciliation(one: ShareClass, layout: SheetLayout) -> list[dict]:
    """Shares outstanding from the reconciliation: the PY opening and both closings (the CY opening is the PY closing)."""
    balance = one.table.balance_concept
    items = {i.preferred_label: i for i in one.table.items if i.concept == balance}
    if not balance or "periodStartLabel" not in items or "periodEndLabel" not in items:
        return []
    out = []
    for row in layout.rows:
        if not _in_reconciliation(row):
            continue
        for scope, ref in row.cells.items():
            if not row.values.get(scope):
                continue
            if _OPENING.search(row.label) and scope == "PY":
                out.append(_suggestion(row, ref, items["periodStartLabel"], [], one, scope, "reconciliation, opening"))
            elif _CLOSING.search(row.label) and not _OPENING.search(row.label):
                out.append(_suggestion(row, ref, items["periodEndLabel"], [], one, scope, "reconciliation, closing"))
    return out


def _holders(tables: TableCatalog, one: ShareClass, layout: SheetLayout, lines: dict[int, str]) -> list[dict]:
    """Holders of more than 5%: each holder's shares (and the percentage on the row below) under the next numbered holder
    member, with the class; with a single holder, also under the class alone (the total)."""
    found = _holders_table(tables, one)
    if found is None:
        return []
    t, axis, shares, percent = found
    holders = [m for m in axis.members if m.usable and re.search(r"\d+Member$", m.member)]
    rows = [r for r in layout.rows if any(_OVER_5.search(h) for h in r.context) and r.values and not _PERCENT_ROW.search(lines.get(r.r, ""))]
    named = [r for r in rows if any(r.values.values())][: len(holders)]
    out = []
    for n, row in enumerate(named):
        member = {"axis": axis.axis, "member": holders[n].member}
        pct = next((r for r in layout.rows if r.r in (row.r + 1, row.r + 2) and _PERCENT_ROW.search(lines.get(r.r, ""))), None)
        for item, src in ((shares, row), (percent, pct)):
            if src is None:
                continue
            for scope, ref in src.cells.items():
                if not src.values.get(scope):
                    continue
                s = _suggestion(src, ref, item, [], ShareClass(t, one.axis, one.member), scope, "shareholder over 5%", total=False)
                s["dims"] = [one.dim, member]
                if len(named) == 1:
                    s["also"] = [{"concept": item.concept, "tableId": t.id, "preferredLabel": None, "dims": [one.dim], "confidence": CONFIDENCE, "reason": "the only holder over 5%"}]
                out.append(s)
    return out


def _holders_table(tables: TableCatalog, one: ShareClass) -> tuple[TableInfo, TableAxis, TableItem, TableItem] | None:
    """The table with the classes axis and a numbered holders axis, a share count and a percentage."""
    for t in tables.tables:
        axes = [a for a in t.axes if a.axis != one.axis.axis and not a.typed]
        if len(t.axes) != 2 or len(axes) != 1 or one.axis.axis not in {a.axis for a in t.axes}:
            continue
        shares = next((i for i in t.items if i.data_type == "xbrli:sharesItemType"), None)
        percent = next((i for i in t.items if i.data_type == "num:percentItemType"), None)
        if shares and percent and any(_NUMBERED_FIRST.match(m.member.split(":")[-1]) for m in axes[0].members):
            return t, axes[0], shares, percent
    return None
