import pytest
from src.core.authority import get_authority
from src.core.model import Filing
from src.engine.calculation import run_calculations, CalcStatus
from src.engine.expr import eval_pred, eval_expr
from src.engine.applicability import Applicability
from src.engine.rules import RuleEngine
from src.engine.generator import generate_instance
from src.engine.gate import Gate, html_guideline_issues


@pytest.fixture(scope="session")
def A():
    return get_authority()


@pytest.fixture
def sample_filing(A):
    filing = Filing(A, {
        "name": "Acme Corp",
        "cin": "U12345MH2020PTC123456",
        "periods": {
            "cy": {"start": "2025-04-01", "end": "2026-03-31"},
            "py": {"start": "2024-04-01", "end": "2025-03-31"},
        },
        "level": "Actual",
        "displayPlaces": 2,
    })
    sc_q = A.qname_of_local("ShareCapital")
    p_cy = filing.period(sc_q, "CY")
    p_py = filing.period(sc_q, "PY")
    filing.set_display_value(sc_q, p_cy, "100000.00")
    filing.set_display_value(sc_q, p_py, "100000.00")
    return filing


def test_html_guidelines():
    issues = html_guideline_issues("<p>Valid text</p>")
    assert len(issues) == 0

    bad = html_guideline_issues("<col width='10'>")
    assert any("rejected" in i for i in bad)


def test_generator(A, sample_filing):
    gen = generate_instance(A, sample_filing)
    assert gen["xml"].startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert "<xbrli:xbrl" in gen["xml"]
    assert "U12345MH2020PTC123456" in gen["xml"]
    assert "</xbrli:xbrl>" in gen["xml"]


def test_applicability(A, sample_filing):
    app = Applicability(A)
    bs_elr = A.elr_by_code("100100")
    st = app.elr_status(sample_filing, bs_elr["uri"], "CY")
    assert st["applicable"]


def test_rules_and_gate(A, sample_filing):
    gate = Gate(A)
    res = gate.run(sample_filing)
    assert "issues" in res
    assert "summary" in res
