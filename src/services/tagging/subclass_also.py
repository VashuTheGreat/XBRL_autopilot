"""Sub-classification "also" (ADR-0013: figures reported twice). A statement figure such as "Loans, current" is filed
again in the table that sub-classifies it: Loans under Current, and under Current + "Unsecured, considered good", as the
net and the gross amount (DGPL → Dixon: loans, trade receivables).

Everything comes from labels, never codes:
- **the table and its member:** the statement element's label is a line item's label plus one member's ("Loans, current"
  = "Loans" + "Current [Member]"), in exactly one table;
- **more members:** a line of the note that shows the figure names a member of another axis of that table exactly
  ("(Unsecured, considered good)");
- **gross:** the table's "<label>, gross" item too, when the note shows no allowance or impairment for it.

The items ride on sure statement suggestions as `also` (not accepted in bulk); the app files each as its own fact.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from src.services.tagging.layout import SheetLayout
from src.services.tagging.table_catalog import TableAxis, TableCatalog, TableInfo, TableItem, TableMember, text_tokens

CONFIDENCE = 0.7  # under 0.9: never accepted in bulk
SAME_FIGURE = 0.005  # in the sheet's units
NOTE_ROWS = 25  # a note section's reach from its heading
_NOTE_HEADING = re.compile(r"^\s*(?:note\b|\d{1,2}\s*[.):]\s+[A-Za-z])", re.I)
_ALLOWANCE = re.compile(r"\b(?:allowance|provision|impair\w*|doubtful|expected\s+credit\s+loss)\b", re.I)
GROSS = frozenset({"gross"})


@dataclass(frozen=True)
class NoteLine:
    text: str
    has_figure: bool  # a non-zero number in the same row


class NoteEvidence:
    """The note text around a statement figure: the sections (a "NOTE …" heading to the next) of note sheets with a row
    showing the same value."""

    def __init__(self, sheets: list[dict], layouts: list[SheetLayout]):
        self._value: dict[tuple[str, str], float] = {}
        self._note_rows: list[tuple[str, int, float]] = []
        for layout in layouts:
            for row in layout.rows:
                for scope, ref in row.cells.items():
                    self._value[(row.sheet, ref)] = row.values[scope]
                if layout.kind == "notes":
                    self._note_rows.extend((row.sheet, row.r, v) for v in row.values.values() if v)
        self._lines: dict[str, dict[int, NoteLine]] = {}
        for sheet in sheets:
            texts: dict[int, list[tuple[int, str]]] = {}
            figures: set[int] = set()
            for c in sheet["cells"]:
                v = c["v"]
                if isinstance(v, str) and v.strip():
                    texts.setdefault(c["r"], []).append((c["c"], v.strip()))
                elif isinstance(v, (int, float)) and not isinstance(v, bool) and v:
                    figures.add(c["r"])
            self._lines[sheet["name"]] = {r: NoteLine(" ".join(t for _, t in sorted(ts)), r in figures) for r, ts in texts.items()}

    def value_at(self, sheet: str, ref: str) -> float | None:
        return self._value.get((sheet, ref))

    def lines_showing(self, value: float, subject: frozenset[str]) -> list[NoteLine]:
        """The lines of the notes that show `value` and whose heading names `subject` ("NOTE 12 : LOANS" for loans; not
        the financial-instruments note that lists the same figure among others)."""
        out: list[NoteLine] = []
        for sheet, r, v in self._note_rows:
            if abs(v - value) <= SAME_FIGURE:
                out.extend(self._section(sheet, r, subject))
        return out

    def _section(self, sheet: str, r: int, subject: frozenset[str]) -> list[NoteLine]:
        lines = self._lines.get(sheet, {})
        start = next((x for x in range(r, r - NOTE_ROWS, -1) if x in lines and _NOTE_HEADING.match(lines[x].text)), None)
        if start is None or not subject <= text_tokens(lines[start].text):
            return []
        end = next((x for x in range(start + 1, start + NOTE_ROWS) if x in lines and _NOTE_HEADING.match(lines[x].text)), start + NOTE_ROWS)
        return [lines[x] for x in range(start, end) if x in lines]


@dataclass(frozen=True)
class _Hit:
    table: TableInfo
    item: TableItem
    axis: TableAxis
    member: TableMember


def subclassification_also(catalog: TableCatalog, label_of: Callable[[str], str], suggestion: dict,
                           evidence: NoteEvidence) -> list[dict]:
    hit = _table_of(catalog, text_tokens(label_of(suggestion["concept"])))
    if hit is None:
        return []
    dims = [{"axis": hit.axis.axis, "member": hit.member.member}]
    value = evidence.value_at(suggestion["cell"]["sheet"], suggestion["cell"]["ref"])
    lines = evidence.lines_showing(value, hit.item.base) if value else []
    named = {text_tokens(line.text) for line in lines}
    extra = []  # at most one member per other axis, the one a line of the note names
    for a in hit.table.axes:
        if a.typed or a.axis == hit.axis.axis:
            continue
        m = next((m for m in a.members if m.usable and not m.is_default and m.tokens in named), None)
        if m is not None:
            extra.append({"axis": a.axis, "member": m.member})
    items = [hit.item]
    if not any(line.has_figure and _ALLOWANCE.search(line.text) for line in lines):
        items += [i for i in _unique(hit.table.items) if i.base == hit.item.base | GROSS]
    variants = [dims, *([dims + extra] if extra else [])]
    return [{"concept": i.concept, "tableId": hit.table.id, "preferredLabel": None, "dims": d, "confidence": CONFIDENCE, "reason": "sub-classification"}
            for i in items for d in variants]


def _table_of(catalog: TableCatalog, words: frozenset[str]) -> _Hit | None:
    """The one table with a line item whose label plus one member's makes the statement label."""
    hits: dict[str, _Hit] = {}
    for t in catalog.tables:
        for i in _unique(t.items):
            if not i.base or not i.base < words:
                continue
            rest = words - i.base
            for a in t.axes:
                m = None if a.typed else next((m for m in a.members if m.usable and not m.is_default and m.tokens == rest), None)
                if m is not None:
                    hits.setdefault(t.id, _Hit(t, i, a, m))
    return next(iter(hits.values())) if len(hits) == 1 else None


def _unique(items: tuple[TableItem, ...]) -> list[TableItem]:
    """One item per element (a table lists an element once per label role)."""
    seen: dict[str, TableItem] = {}
    for i in items:
        if i.preferred_label != "periodStartLabel":
            seen.setdefault(i.concept, i)
    return list(seen.values())
