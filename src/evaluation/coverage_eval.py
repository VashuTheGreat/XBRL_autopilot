"""End-to-end tagging coverage: every fact of a filed instance, not only the keyed statement cells (docs/06).

For each filed fact (DGPL workbook ↔ Dixon's MCA-accepted instance, 2,666 facts) the report says:
- its kind and section (fact_kinds.py);
- whether its value is in the workbook: in a presentation sheet, only in a working paper, absent, or not locatable by
  value (zero, nil, Yes/No) (workbook_index.py);
- whether we produce it (same concept, period end and dimensions) and, if so, whether our value is the filed one.

"Produced" facts come from producers, each scored on its own (right / near / wrong / extra):
- `statement`: the Phase 8 statement tagger's suggestions (`produced_from_suggestions`);
- `table`: the table suggester's blocks, cell by cell (`produced_from_blocks`, ADR-0013);
- `also`: "also report as" facts attached to statement suggestions (the one class of a classes axis).
Text tagging and the filing-details form add producers of their own. A produced fact that Dixon did not file is counted
as `extra` (a wrong element, or a figure the filer left out). When two producers give the same fact, the first wins.

Runs with the LLM off: data/ fixtures never go to an AI service. CLI: `uv run python -m src.evaluation.coverage_eval`
(`--tables` adds the note tables ranked by their non-zero amounts).
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from src.evaluation.autotag_eval import DGPL, DIXON
from src.evaluation.fact_kinds import FactClass, FactClassifier, FactKind
from src.evaluation.instance_facts import FiledFact, read_facts
from src.evaluation.workbook_index import SCALES, Location, WorkbookIndex, _tolerance, norm_text
from src.services.engine_authority.specs import SPECS
from src.services.tagging.catalog import catalog_for
from src.services.tagging.layout import analyse_sheet
from src.services.tagging.suggest import SuggestResult, suggest
from src.services.workbook.reader import read_workbook

Key = tuple[str, dt.date, tuple]


@dataclass(frozen=True)
class ProducedFact:
    concept: str
    end: dt.date
    dims: tuple[tuple[str, str], ...]
    value: Decimal | str  # rupees for an amount, text otherwise
    source: str  # "sheet!A1" (or "form:<field>" later)
    producer: str = "statement"

    @property
    def key(self) -> Key:
        return (self.concept, self.end, self.dims)


@dataclass
class Bucket:
    total: int = 0
    zero: int = 0  # amount 0 or nil
    presentation: int = 0
    working_only: int = 0
    absent: int = 0
    not_by_value: int = 0
    produced: int = 0
    right: int = 0
    near: int = 0  # off by one unit in the last place (₹1,000 at decimals=-3): another rounding or a filer's adjustment

    @property
    def wrong(self) -> int:
        return self.produced - self.right - self.near

    def add(self, loc: Location, zero: bool, produced: bool, verdict: str | None) -> None:
        self.total += 1
        self.zero += zero
        setattr(self, loc.value, getattr(self, loc.value) + 1)
        self.produced += produced
        self.right += verdict == "right"
        self.near += verdict == "near"


@dataclass
class CoverageReport:
    by_kind: dict[FactKind, Bucket]
    by_kind_section: dict[tuple[FactKind, str], Bucket]
    by_table: dict[str, Bucket]  # table id → bucket of its amounts
    extra: Counter  # produced facts Dixon didn't file, by kind of the produced concept
    by_producer: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))  # producer → right/near/wrong/extra
    total: int = 0
    produced_total: int = 0
    wrong_examples: list[str] = field(default_factory=list)

    def text(self, tables: bool = False) -> str:
        head = f"{'kind':<14}{'section':<12}{'facts':>6}{'zero':>6}{'in pres.':>9}{'work only':>10}{'absent':>7}{'n/a val':>8}{'produced':>9}{'right':>6}{'near':>5}{'wrong':>6}"
        lines = [f"filed facts {self.total}; produced {self.produced_total} (+{sum(self.extra.values())} not filed)", "", head]
        def row(name: str, section: str, b: Bucket) -> str:
            return (f"{name:<14}{section:<12}{b.total:>6}{b.zero:>6}{b.presentation:>9}{b.working_only:>10}{b.absent:>7}"
                    f"{b.not_by_value:>8}{b.produced:>9}{b.right:>6}{b.near:>5}{b.wrong:>6}")
        for kind in FactKind:
            lines.append(row(kind.value, "all", self.by_kind.get(kind, Bucket())))
            for section in ("statements", "notes", "general"):
                b = self.by_kind_section.get((kind, section))
                if b and b.total:
                    lines.append(row("", section, b))
        lines += ["", "not filed (extra) by kind: " + ", ".join(f"{k.value} {v}" for k, v in sorted(self.extra.items())) or "none"]
        lines += ["", "BY PRODUCER:", *(f"  {p:<10} right {c['right']:>4}  near {c['near']:>3}  wrong {c['wrong']:>3}  extra {c['extra']:>3}" for p, c in sorted(self.by_producer.items()))]
        if self.wrong_examples:
            lines += ["", "WRONG VALUES (first 20):", *(f"  {w}" for w in self.wrong_examples[:20])]
        if tables:
            lines += ["", "TABLE AMOUNTS by table (non-zero first):",
                      f"  {'table':<70}{'facts':>6}{'zero':>6}{'in pres.':>9}{'absent':>7}{'right':>6}"]
            ranked = sorted(self.by_table.items(), key=lambda x: (-(x[1].total - x[1].zero), x[0]))
            lines += [f"  {t[:70]:<70}{b.total:>6}{b.zero:>6}{b.presentation:>9}{b.absent:>7}{b.right:>6}" for t, b in ranked]
        return "\n".join(lines)


def verdict(fact: FiledFact, produced: ProducedFact) -> str:
    """right | near | wrong. Amounts compare by magnitude (a sign is a separate question)."""
    if isinstance(produced.value, Decimal):
        amount = fact.amount
        if amount is None:
            return "right" if fact.nil and produced.value == 0 else "wrong"
        diff = abs(abs(amount) - abs(produced.value))
        if diff <= _tolerance(fact):
            return "right"
        unit = Decimal(10) ** (-fact.decimals) if fact.decimals is not None else Decimal(1)
        return "near" if diff <= unit else "wrong"
    return "right" if norm_text(fact.text) == norm_text(produced.value) else "wrong"


def filed_amount(v: float, sheet_scale: int, level: str, places: int) -> Decimal:
    """A cell as the app files it (ADR-0009): rounded once, half away from zero, to the statement's places, × scale."""
    places = 0 if level == "Actual" else places
    return Decimal(repr(v)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP) * sheet_scale


def produced_from_suggestions(result: SuggestResult, cy_end: dt.date, py_end: dt.date | None, level: str,
                              places: int = 2) -> list[ProducedFact]:
    """The statement tagger's suggestions as facts: each suggested cell as the app would file it (`filed_amount`), at
    its scope's period end. Accepting every suggestion is assumed (the user decides, in the app)."""
    value_at = {}
    for rc in result.rows:
        for scope, ref in rc.row.cells.items():
            value_at[(rc.row.sheet, ref)] = rc.row.values[scope]
    scale_of = {l.sheet: SCALES[l.scale or level] for l in result.layouts}
    ends = {"CY": cy_end, "PY": py_end}
    out = []
    for s in result.suggestions:
        sheet, ref = s["cell"]["sheet"], s["cell"]["ref"]
        end = ends.get(s["scope"])
        v = value_at.get((sheet, ref))
        if end is None or v is None:
            continue
        dims = tuple(sorted((d["axis"], d.get("member") or d.get("typed")) for d in s.get("dims") or []))
        rupees = filed_amount(v, scale_of.get(sheet, SCALES[level]), level, places) * s.get("sign", 1)
        out.append(ProducedFact(s["concept"], end, dims, rupees, f"{sheet.strip()}!{ref}"))
        for a in s.get("also", []):
            also_end = period_end(s["scope"], a.get("preferredLabel"), cy_end, py_end)
            also_dims = tuple(sorted((d["axis"], d.get("member") or d.get("typed")) for d in a["dims"]))
            if also_end:
                out.append(ProducedFact(a["concept"], also_end, also_dims, rupees, f"{sheet.strip()}!{ref}", "also"))
    return out


def period_end(scope: str, preferred_label: str | None, cy_end: dt.date, py_end: dt.date | None) -> dt.date | None:
    """The instant / end date of a table cell: an opening balance is the day before the year starts."""
    if preferred_label == "periodStartLabel":
        return py_end if scope == "CY" else (py_end.replace(year=py_end.year - 1) if py_end else None)
    return cy_end if scope == "CY" else py_end


def produced_from_blocks(result: SuggestResult, sheets: list[dict], cy_end: dt.date, py_end: dt.date | None, level: str,
                         places: int = 2) -> list[ProducedFact]:
    """The table suggester's cells as facts (each block cell × its sheet's scale, as the app would file it), with the
    facts each cell also reports (table_also.py)."""
    from src.services.tagging.layout import a1

    values = {(s["name"], a1(c["r"], c["c"])): c["v"] for s in sheets for c in s["cells"] if isinstance(c["v"], (int, float)) and not isinstance(c["v"], bool)}
    scale_of = {l.sheet: SCALES[l.scale or level] for l in result.layouts}
    out = []
    for b in result.blocks:
        for c in b.cells:
            v = values.get((b.sheet, c.ref))
            end = period_end(c.scope, c.preferred_label, cy_end, py_end)
            if v is None or end is None:
                continue
            amount = filed_amount(v, scale_of.get(b.sheet, SCALES[level]), level, places)
            for concept, label, dims in [(c.concept, c.preferred_label, c.dims), *((a["concept"], a.get("preferredLabel"), a["dims"]) for a in c.also)]:
                at = period_end(c.scope, label, cy_end, py_end)
                key = tuple(sorted((d["axis"], d.get("member") or d.get("typed")) for d in dims))
                if at:
                    out.append(ProducedFact(concept, at, key, amount, f"{b.sheet.strip()}!{c.ref}", "table"))
    return out


_NUMBERED = re.compile(r"^(.*?)(\d+)Member$")


def align_placeholders(produced: list[ProducedFact], facts: list[FiledFact]) -> list[ProducedFact]:
    """Numbered members ("Other financial assets at amortised cost, class 1 … 10") are placeholders: MCA accepts any
    numbering, so ours is compared with the filer's by value. A produced fact under a numbered member takes the filed
    member of the same family whose fact (same element, period, other members) has its value, when one is free."""
    def split(dims):
        for i, (axis, m) in enumerate(dims):
            hit = _NUMBERED.match(m.split(":")[-1]) if isinstance(m, str) else None
            if hit:
                return i, (axis, hit.group(1)), dims[:i] + dims[i + 1:]
        return None

    filed: dict[tuple, list[FiledFact]] = defaultdict(list)
    for f in facts:
        s = split(f.dims)
        if s and f.numeric:
            filed[(f.concept, f.end, s[1], s[2])].append(f)
    taken: set[Key] = set()
    out = []
    for p in produced:
        s = split(p.dims)
        if not s or not isinstance(p.value, Decimal):
            out.append(p)
            continue
        i, family, rest = s
        match = next((f for f in filed.get((p.concept, p.end, family, rest), []) if f.key not in taken and verdict(f, p) == "right"), None)
        if match is None:
            out.append(p)
            continue
        taken.add(match.key)
        out.append(dataclasses.replace(p, dims=match.dims))
    return out


def coverage(facts: list[FiledFact], classifier: FactClassifier, index: WorkbookIndex,
             produced: list[ProducedFact]) -> CoverageReport:
    produced = align_placeholders(produced, facts)
    by_key: dict[Key, ProducedFact] = {}
    for p in produced:
        by_key.setdefault(p.key, p)
    filed_keys = set()
    report = CoverageReport(defaultdict(Bucket), defaultdict(Bucket), defaultdict(Bucket), Counter())
    for f in facts:
        cls = classifier.classify(f)
        filed_keys.add(f.key)
        loc, _ = index.locate(f, cls)
        p = by_key.get(f.key)
        v = verdict(f, p) if p is not None else None
        zero = f.nil or (f.amount is not None and f.amount == 0)
        for b in (report.by_kind[cls.kind], report.by_kind_section[(cls.kind, cls.section)]):
            b.add(loc, zero, p is not None, v)
        if cls.kind is FactKind.TABLE_AMOUNT:
            report.by_table[cls.table_id or "?"].add(loc, zero, p is not None, v)
        if p is not None:
            report.by_producer[p.producer][v] += 1
        if v == "wrong":
            report.wrong_examples.append(f"{p.source}: {f.concept} {f.end} filed {f.text.strip()[:20]}, ours {p.value}")
        report.total += 1
    report.produced_total = sum(1 for k in by_key if k in filed_keys)
    for k, p in by_key.items():
        if k in filed_keys:
            continue
        report.by_producer[p.producer]["extra"] += 1
        pseudo = FiledFact(p.concept, p.end, True, p.dims, "INR" if isinstance(p.value, Decimal) else None, None, str(p.value))
        report.extra[classifier.classify(pseudo).kind] += 1
    return report


def run_dgpl_dixon() -> tuple[CoverageReport, SuggestResult]:
    cy_end, py_end, level = dt.date(2026, 3, 31), dt.date(2025, 3, 31), "Lakhs"
    sheets = read_workbook(DGPL.read_bytes())["sheets"]
    layouts = [analyse_sheet(s, cy_end, py_end) for s in sheets]
    with SPECS["ind_as_taxonomy"].output.open(encoding="utf-8") as fh:
        classifier = FactClassifier(json.load(fh))
    result = suggest(catalog_for("ind_as_taxonomy"), sheets, cy_end, py_end)  # LLM off: fixtures stay local
    produced = produced_from_suggestions(result, cy_end, py_end, level) + produced_from_blocks(result, sheets, cy_end, py_end, level)
    report = coverage(read_facts(DIXON), classifier, WorkbookIndex(sheets, layouts, level), produced)
    return report, result


if __name__ == "__main__":
    report, _ = run_dgpl_dixon()
    print(report.text(tables="--tables" in sys.argv))
