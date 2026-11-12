"""End-to-end tagging coverage on real data: every fact of Dixon's filed instance vs the DGPL workbook (docs/06).

The classification counts are exact (they describe the instance). The "in a presentation sheet" figures bound what
tagging from Excel can reach; the "right" floors sit a little under today's results (2026-11-11) so a change that
makes tagging worse fails here. Raise them as table tagging, text tagging and the filing-details form land.
LLM off: data/ fixtures never go to an AI service.
"""
import pytest

from src.evaluation.autotag_eval import DGPL, DIXON
from src.evaluation.coverage_eval import run_dgpl_dixon
from src.evaluation.fact_kinds import FactKind

pytestmark = pytest.mark.skipif(not (DGPL.exists() and DIXON.exists()), reason="real-data fixtures not present")

# kind → (facts, zero, in a presentation sheet ≥, produced right ≥)
EXPECTED = {
    FactKind.AMOUNT: (638, 363, 240, 135),
    FactKind.TABLE_AMOUNT: (1548, 1260, 265, 0),
    FactKind.VALUE: (159, 0, 20, 0),
    FactKind.TABLE_VALUE: (268, 0, 105, 0),
    FactKind.TEXT_BLOCK: (53, 0, 8, 0),
}
EXTRA_CEILING = 125  # produced facts Dixon didn't file (wrong element or a figure the filer left out): 113 today


@pytest.fixture(scope="module")
def report():
    r, _ = run_dgpl_dixon()
    return r


def test_every_fact_is_classified(report):
    assert report.total == 2666
    assert sum(b.total for b in report.by_kind.values()) == 2666
    for kind, (facts, zero, _, _) in EXPECTED.items():
        b = report.by_kind[kind]
        assert (b.total, b.zero) == (facts, zero), (kind, b)


def test_values_found_in_the_workbook(report):
    print(report.text(tables=True))
    for kind, (_, _, in_presentation, _) in EXPECTED.items():
        assert report.by_kind[kind].presentation >= in_presentation, (kind, report.by_kind[kind])


def test_produced_facts_are_right(report):
    for kind, (_, _, _, right) in EXPECTED.items():
        assert report.by_kind[kind].right >= right, (kind, report.by_kind[kind])
    assert sum(report.extra.values()) <= EXTRA_CEILING, report.extra


def test_general_information_is_mostly_not_in_the_workbook(report):
    general = [b for (kind, section), b in report.by_kind_section.items() if section == "general"]
    total = sum(b.total for b in general)
    found = sum(b.presentation for b in general)
    assert total >= 150 and found / total < 0.25  # what the filing-details form must supply (153 / 31 today)
