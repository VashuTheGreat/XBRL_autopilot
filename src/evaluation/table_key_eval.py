"""Table suggestions against a hand-checked key (C&I has no before/after XML pair yet): HPL workbook ↔ facts read from
Helmier's filed instance PDF (tests/fixtures/hpl_table_key.json). LLM off; the workbook stays in this process.

A key fact is `right` when the table suggester produces the same element, period end and members (by local name, the
axis at its default left out) with the same value at 2 decimals; `wrong` when it produces that element and period with
the same members but another value; `missing` otherwise. A key fact marked `filerChoice` uses a member the workbook
doesn't show (the filer's own choice): it is reported apart.
CLI: `uv run python -m src.evaluation.table_key_eval`
"""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from src.evaluation.coverage_eval import period_end
from src.services.tagging.layout import a1, analyse_sheet
from src.services.tagging.tables import suggest_tables, table_catalog_for
from src.services.workbook.reader import read_workbook

ROOT = Path(__file__).resolve().parents[2]
HPL_KEY = ROOT / "tests" / "fixtures" / "hpl_table_key.json"
MAX_CELLS = 60_000  # the ledger dump sheet is skipped, as the app's grid does


@dataclass
class KeyReport:
    right: list[str] = field(default_factory=list)
    wrong: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    filer_choice_missing: list[str] = field(default_factory=list)

    def text(self) -> str:
        return "\n".join([
            f"right {len(self.right)}  wrong {len(self.wrong)}  missing {len(self.missing)}  (filer's own members, not in the workbook: {len(self.filer_choice_missing)})",
            *(f"  WRONG   {x}" for x in self.wrong), *(f"  MISSING {x}" for x in self.missing),
        ])


def run_key(key_file: Path = HPL_KEY) -> KeyReport:
    key = json.loads(key_file.read_text(encoding="utf-8"))
    cy_end, py_end = dt.date.fromisoformat(key["periods"]["cyEnd"]), dt.date.fromisoformat(key["periods"]["pyEnd"])
    sheets = [s for s in read_workbook((ROOT / "data" / key["workbook"]).read_bytes())["sheets"] if len(s["cells"]) <= MAX_CELLS]
    layouts = [analyse_sheet(s, cy_end, py_end) for s in sheets]
    blocks = suggest_tables(table_catalog_for(key["taxonomy"]), sheets, layouts, cy_end, py_end)
    values = {(s["name"], a1(c["r"], c["c"])): c["v"] for s in sheets for c in s["cells"]}
    produced: dict[tuple, Decimal] = {}
    for b in blocks:
        for c in b.cells:
            v = values.get((b.sheet, c.ref))
            end = period_end(c.scope, c.preferred_label, cy_end, py_end)
            if isinstance(v, (int, float)) and end:
                members = frozenset(d["member"].split(":")[-1] for d in c.dims if d.get("member"))
                produced.setdefault((c.concept, end.isoformat(), members), Decimal(repr(v)).quantize(Decimal("0.01"), ROUND_HALF_UP))
    report = KeyReport()
    for f in key["facts"]:
        k = (f["concept"], f["end"], frozenset(f["members"]))
        name = f"{f['concept'].split(':')[-1]} {f['end']} {sorted(f['members'])} = {f['value']}"
        got = produced.get(k)
        if got is not None and got == Decimal(f["value"]):
            report.right.append(name)
        elif got is not None:
            report.wrong.append(f"{name}, ours {got}")
        elif f.get("filerChoice"):
            report.filer_choice_missing.append(name)
        else:
            report.missing.append(name)
    return report


if __name__ == "__main__":
    print(run_key().text())
