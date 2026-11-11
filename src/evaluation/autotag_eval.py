"""Auto-tagging evaluation against a filed instance (DGPL workbook ↔ Dixon's MCA-accepted XBRL, docs/12).

The answer key is built from amounts, not by hand: a value cell (CY or PY, non-zero) is keyed to every
non-dimensional INR fact of that period whose value equals the cell × scale (lakhs → ×1,00,000) within the fact's
`decimals` tolerance (decimals=-3 → ±500). Any of those concepts counts as right. Cells that match no fact are left
out (the filer may have split or merged them).

- precision = suggestions on keyed cells whose concept is in the cell's key / suggestions on keyed cells
- recall    = keyed cells whose right concept is suggested (on that cell, or on another cell with the same figure:
              one fact ← one cell) / keyed cells

Runs with the LLM off: data/ fixtures are never sent to an AI service. CLI: `uv run python -m src.evaluation.autotag_eval`
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from src.evaluation.instance_facts import InstanceFact, read_numeric_facts
from src.services.tagging.catalog import TaggingCatalog, catalog_for
from src.services.tagging.suggest import SuggestResult, suggest
from src.services.workbook.reader import read_workbook

ROOT = Path(__file__).resolve().parents[2]
DGPL = ROOT / "data" / "BS DGPL Mar-2026-V1.xls"
DIXON = ROOT / "data" / "Instance_Dixon_Global_Private_2025-26_001.xml"
MIN_KEYED_RUPEES = 1_000
SCALES = {"Actual": 1, "Thousands": 1_000, "Lakhs": 100_000, "Millions": 1_000_000, "Crores": 10_000_000}


@dataclass
class KeyedCell:
    sheet: str
    ref: str
    label: str
    scope: str
    amount: Decimal  # rupees
    concepts: set[str]


@dataclass
class Miss:
    sheet: str
    ref: str
    label: str
    expected: list[str]
    got: str | None


@dataclass
class EvalReport:
    keyed: int
    suggested_on_keyed: int
    correct: int
    covered: int
    unkeyed_suggestions: int
    high_on_key: int = 0  # suggestions with confidence >= 0.9 on keyed cells
    high_correct: int = 0
    wrong: list[Miss] = field(default_factory=list)
    missed: list[Miss] = field(default_factory=list)

    @property
    def precision(self) -> float:
        return self.correct / self.suggested_on_keyed if self.suggested_on_keyed else 0.0

    @property
    def high_precision(self) -> float:
        return self.high_correct / self.high_on_key if self.high_on_key else 0.0

    @property
    def recall(self) -> float:
        return self.covered / self.keyed if self.keyed else 0.0

    def text(self) -> str:
        lines = [
            f"keyed cells {self.keyed}; suggestions on them {self.suggested_on_keyed}, right {self.correct}",
            f"precision {self.precision:.3f}  recall {self.recall:.3f}  (suggestions on unkeyed cells: {self.unkeyed_suggestions})",
            f"confidence >= 0.9: {self.high_correct}/{self.high_on_key} right ({self.high_precision:.3f})",
            "", "WRONG:",
            *(f"  {m.sheet.strip()}!{m.ref} {m.label[:50]!r}: got {m.got}, expected {' | '.join(m.expected[:3])}" for m in self.wrong),
            "", "MISSED (no suggestion):",
            *(f"  {m.sheet.strip()}!{m.ref} {m.label[:50]!r}: expected {' | '.join(m.expected[:3])}" for m in self.missed),
        ]
        return "\n".join(lines)


def _tolerance(f: InstanceFact) -> Decimal:
    return Decimal(5) * Decimal(10) ** (-(f.decimals or 0) - 1) if f.decimals is not None else Decimal("0.5")


def answer_key(result: SuggestResult, facts: list[InstanceFact], cy_end: dt.date, py_end: dt.date | None,
               catalog: TaggingCatalog, scale: int) -> list[KeyedCell]:
    ends = {"CY": cy_end, "PY": py_end}
    by_end: dict[dt.date, list[InstanceFact]] = defaultdict(list)
    for f in facts:
        if not f.dims and f.unit == "INR" and f.concept in catalog.concepts:
            by_end[f.end].append(f)
    keyed = []
    for rc in result.rows:
        row = rc.row
        for scope, value in row.values.items():
            amount = (Decimal(repr(value)) * scale).quantize(Decimal("1"))
            # zero rows are excluded, and so are figures under ₹1,000: at decimals=-3 they match anything rounded to 0
            if abs(amount) < MIN_KEYED_RUPEES or ends.get(scope) is None:
                continue
            concepts = {f.concept for f in by_end[ends[scope]] if abs(abs(f.value) - abs(amount)) <= _tolerance(f)}
            if concepts:
                keyed.append(KeyedCell(row.sheet, row.cells[scope], row.label, scope, amount, concepts))
    return keyed


def evaluate(result: SuggestResult, keyed: list[KeyedCell]) -> EvalReport:
    by_cell = {(s["cell"]["sheet"], s["cell"]["ref"]): s for s in result.suggestions}
    # (concept, scope) → amounts its suggested cells carry, to credit a figure shown twice
    suggested_amounts: dict[tuple[str, str], set[Decimal]] = defaultdict(set)
    cell_amount = {(k.sheet, k.ref): k.amount for k in keyed}
    for s in result.suggestions:
        a = cell_amount.get((s["cell"]["sheet"], s["cell"]["ref"]))
        if a is not None:
            suggested_amounts[(s["concept"], s["scope"])].add(abs(a))
    report = EvalReport(len(keyed), 0, 0, 0, 0)
    keyed_cells = set(cell_amount)
    report.unkeyed_suggestions = sum(1 for c in by_cell if c not in keyed_cells)
    for k in keyed:
        s = by_cell.get((k.sheet, k.ref))
        expected = sorted(k.concepts)
        if s is not None:
            report.suggested_on_keyed += 1
            if s["confidence"] >= 0.9:
                report.high_on_key += 1
                report.high_correct += s["concept"] in k.concepts
            if s["concept"] in k.concepts:
                report.correct += 1
                report.covered += 1
                continue
            report.wrong.append(Miss(k.sheet, k.ref, k.label, expected, s["concept"]))
            continue
        if any(abs(k.amount) in suggested_amounts.get((c, k.scope), ()) for c in k.concepts):
            report.covered += 1
        else:
            report.missed.append(Miss(k.sheet, k.ref, k.label, expected, None))
    return report


def run_dgpl_dixon() -> tuple[EvalReport, SuggestResult]:
    catalog = catalog_for("ind_as_taxonomy")
    sheets = read_workbook(DGPL.read_bytes())["sheets"]
    cy_end, py_end = dt.date(2026, 3, 31), dt.date(2025, 3, 31)
    result = suggest(catalog, sheets, cy_end, py_end)  # LLM off: fixtures never leave the machine
    keyed = answer_key(result, read_numeric_facts(DIXON), cy_end, py_end, catalog, SCALES["Lakhs"])
    return evaluate(result, keyed), result


if __name__ == "__main__":
    report, _ = run_dgpl_dixon()
    print(report.text())
