"""Auto-tagging quality on real data: DGPL workbook vs Dixon's filed instance (docs/12). LLM off.

The floors sit a little under today's figures (2026-11-11: precision 0.738, recall 0.793; exact ≥ 0.9 right 73/78)
so a change that makes the tagger worse fails here. Raise them when the tagger improves.
"""
import pytest

from src.evaluation.autotag_eval import DGPL, DIXON, run_dgpl_dixon

PRECISION_FLOOR = 0.70
RECALL_FLOOR = 0.75
HIGH_CONFIDENCE_FLOOR = 0.90  # what "Accept all ≥ 0.9" relies on

pytestmark = pytest.mark.skipif(not (DGPL.exists() and DIXON.exists()), reason="real-data fixtures not present")


@pytest.fixture(scope="module")
def evaluation():
    return run_dgpl_dixon()


def test_answer_key_is_substantial(evaluation):
    report, result = evaluation
    assert report.keyed >= 200
    kinds = {l.sheet.strip(): l.kind for l in result.layouts if l.rows}
    assert kinds["IND AS BS"] == "balance_sheet" and kinds["IND AS P&L"] == "profit_loss"
    assert kinds["Cash Flow Ind AS"] == "cash_flow" and kinds["Notes of IND AS BS"] == "notes"


def test_precision_and_recall_floors(evaluation):
    report, _ = evaluation
    print(report.text())
    assert report.precision >= PRECISION_FLOOR, report.text()
    assert report.recall >= RECALL_FLOOR, report.text()


def test_high_confidence_suggestions_are_safe_to_accept_in_bulk(evaluation):
    report, _ = evaluation
    assert report.high_on_key >= 60
    assert report.high_precision >= HIGH_CONFIDENCE_FLOOR, report.text()


def test_key_statement_lines(evaluation):
    _, result = evaluation
    got = {(s["cell"]["sheet"].strip(), s["cell"]["ref"]): s["concept"] for s in result.suggestions}
    assert got[("IND AS BS", "I24")] == "ind-as:TradeReceivablesCurrent"
    assert got[("IND AS BS", "I34")] == "ind-as:Assets"
    assert got[("IND AS BS", "I39")] == "ind-as:EquityShareCapital"
    assert got[("IND AS P&L", "H11")] == "ind-as:RevenueFromOperations"
