"""Where in a workbook a filed fact's value appears, if anywhere (end-to-end coverage, docs/06).

A fact is located by its value only, never by label: the answer is "this figure / text / date is (or isn't) in the
Excel", which bounds what tagging from Excel can ever produce.
- amounts: a numeric cell × the sheet's scale within the fact's `decimals` tolerance (decimals=-3 → ±500).
  Shares may be shown in lakhs; percentages as 12.5, 0.125 or 1250 (basis points are not tried).
- zero, nil and Yes/No facts can't be located by value (a 0 or "Yes" is everywhere): reported as `not_by_value`.
- text: the normalised text equals a cell's, or (12+ characters) is part of one.
- text blocks: cells of 30+ characters that are part of the block cover at least half of it, or the block is part
  of a cell.
- dates: a date cell, or a date written in a text cell ("31st March 2026", "31.03.2026").

Sheets are `presentation` (statements, notes, policies) or working papers (trial balance, groupings in rupees): a
value found only in a working paper is reported apart, since a filing is tagged from the presented figures.
"""
from __future__ import annotations

import bisect
import html
import re
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from src.evaluation.fact_kinds import FactClass, ValueType
from src.evaluation.instance_facts import FiledFact
from src.services.tagging.layout import SheetLayout, a1
from src.services.tagging.text import header_dates

SCALES = {"Actual": 1, "Thousands": 1_000, "Lakhs": 100_000, "Millions": 1_000_000, "Crores": 10_000_000}
MIN_TEXT_PART = 12
MIN_BLOCK_PIECE = 30
BLOCK_COVERAGE = 0.5
_TAG = re.compile(r"<[^>]+>")
_NON_WORD = re.compile(r"[^0-9a-z]+")


class Location(str, Enum):
    PRESENTATION = "presentation"  # in a statement / note sheet
    WORKING_ONLY = "working_only"  # only in a working paper (TB, groupings)
    ABSENT = "absent"
    NOT_BY_VALUE = "not_by_value"  # zero, nil, Yes/No: can't be located by value


@dataclass(frozen=True)
class CellHit:
    sheet: str
    ref: str
    presentation: bool


def norm_text(s: str) -> str:
    return _NON_WORD.sub(" ", html.unescape(_TAG.sub(" ", s)).casefold()).strip()


def is_presentation(layout: SheetLayout) -> bool:
    """Statements and notes (with a known scale, or text-only notes such as policies); not TB or rupee groupings."""
    return layout.kind != "other" and (layout.scale is not None or layout.kind == "notes")


def _tolerance(f: FiledFact) -> Decimal:
    if f.decimals is not None:
        return Decimal(5) * Decimal(10) ** (-f.decimals - 1)
    return Decimal("0.5") if f.unit in ("INR", "Shares") else Decimal("0.005")


class _Sorted:
    """Absolute values with their cells, for range lookups."""

    def __init__(self):
        self._items: list[tuple[Decimal, CellHit]] = []

    def add(self, value: Decimal, hit: CellHit) -> None:
        self._items.append((abs(value), hit))

    def freeze(self) -> None:
        self._items.sort(key=lambda x: x[0])
        self._keys = [v for v, _ in self._items]

    def within(self, value: Decimal, tol: Decimal) -> list[CellHit]:
        v = abs(value)
        lo = bisect.bisect_left(self._keys, v - tol)
        hi = bisect.bisect_right(self._keys, v + tol)
        return [h for _, h in self._items[lo:hi]]


class WorkbookIndex:
    def __init__(self, sheets: list[dict], layouts: list[SheetLayout], level: str):
        self._money, self._shares, self._plain, self._pure = _Sorted(), _Sorted(), _Sorted(), _Sorted()
        self._texts: list[tuple[str, CellHit]] = []
        self._dates: dict[str, list[CellHit]] = {}
        for sheet, layout in zip(sheets, layouts, strict=True):
            pres = is_presentation(layout)
            scales = {SCALES[layout.scale or level]} | (set() if pres else {1})
            for c in sheet["cells"]:
                hit = CellHit(sheet["name"], a1(c["r"], c["c"]), pres)
                v = c["v"]
                if isinstance(v, bool):
                    continue
                if isinstance(v, (int, float)):
                    d = Decimal(repr(v))
                    for s in scales:
                        self._money.add(d * s, hit)
                    for s in scales | {1}:
                        self._shares.add(d * s, hit)
                    self._plain.add(d, hit)
                    for factor in (Decimal(1), Decimal(100), Decimal("0.01")):
                        self._pure.add(d * factor, hit)
                    continue
                s = str(v)
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}(T.*)?", s):
                    self._dates.setdefault(s[:10], []).append(hit)
                    continue
                for d in header_dates(s):
                    self._dates.setdefault(d.isoformat(), []).append(hit)
                t = norm_text(s)
                if t:
                    self._texts.append((t, hit))
        for x in (self._money, self._shares, self._plain, self._pure):
            x.freeze()

    def locate(self, fact: FiledFact, cls: FactClass) -> tuple[Location, list[CellHit]]:
        if fact.nil or cls.value_type is ValueType.BOOLEAN:
            return Location.NOT_BY_VALUE, []
        if cls.value_type is ValueType.AMOUNT:
            amount = fact.amount
            tol = _tolerance(fact)
            if amount is None or abs(amount) <= tol:
                return Location.NOT_BY_VALUE, []
            pool = {"INR": self._money, "Shares": self._shares, "Pure": self._pure}.get(fact.unit or "", self._plain)
            hits = pool.within(amount, tol)
        elif cls.value_type is ValueType.DATE:
            hits = self._dates.get(fact.text.strip()[:10], [])
        elif cls.value_type is ValueType.TEXT_BLOCK:
            hits = self._block_hits(norm_text(fact.text))
        else:
            hits = self._text_hits(norm_text(fact.text))
        if not hits:
            return Location.ABSENT, []
        pres = [h for h in hits if h.presentation]
        return (Location.PRESENTATION, pres) if pres else (Location.WORKING_ONLY, hits)

    def _text_hits(self, t: str) -> list[CellHit]:
        if not t:
            return []
        exact = [h for x, h in self._texts if x == t]
        if exact or len(t) < MIN_TEXT_PART:
            return exact
        return [h for x, h in self._texts if t in x]

    def _block_hits(self, t: str) -> list[CellHit]:
        if not t:
            return []
        inside = [h for x, h in self._texts if len(t) >= MIN_BLOCK_PIECE and t in x]
        if inside:
            return inside
        pieces = [(x, h) for x, h in self._texts if len(x) >= MIN_BLOCK_PIECE and x in t]
        covered = sum(len(x) for x, _ in {x: h for x, h in pieces}.items())
        return [h for _, h in pieces] if covered >= BLOCK_COVERAGE * len(t) else []
