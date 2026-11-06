import pytest
from src.core.authority import get_authority
from src.services.session import Session
from src.services.importer import import_instance
from src.services.carry_forward import carry_forward
from src.services.totals_fill import fill_totals
from src.services.upkeep import health_check
from tests.fixtures import valid_current_investments_session, CI_TABLE


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_valid_current_investments_end_to_end(A):
    today = "2017-06-30"
    s = valid_current_investments_session(A)
    assert len(s.filing.all()) > 50

    # 1. Run gate validation
    gate_res = s.validate({"today": today})
    # There should be 0 blocking errors
    assert gate_res["blocking"] == 0
    assert gate_res["ok"]

    # 2. Export XML
    exp = s.export_xml({"today": today, "allowErrors": False})
    xml_str = exp["xml"]
    assert xml_str.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    assert "<xbrli:xbrl" in xml_str
    assert "U72200KA2010PTC123456" in xml_str
    assert "</xbrli:xbrl>" in xml_str

    # 3. Re-import XML into a clean session
    imp_res = import_instance(A, xml_str, file_name="reimport.xml", year_mode="both")
    reimported_filing = imp_res["filing"]
    s2 = Session(A, reimported_filing)

    # 4. Check facts parity between original and reimported session
    ci_q = A.qname_of_local("CurrentInvestments")
    assert s2.getValue(ci_q, "CY").value == "1000"
    assert s2.getValue(ci_q, "PY").value == "800"

    tp_q = A.qname_of_local("TradePayables")
    assert s2.getValue(tp_q, "CY").value == "1000"
    assert s2.getValue(tp_q, "PY").value == "800"

    # Gate on reimported session should also be completely clean
    reimport_gate = s2.validate({"today": today})
    assert reimport_gate["blocking"] == 0
    assert reimport_gate["ok"]


def test_carry_forward_workflow(A):
    s = valid_current_investments_session(A)
    # Carry forward CI table
    cf_res = carry_forward(s, CI_TABLE, values=True)
    assert "columns" in cf_res
    assert "values" in cf_res


def test_totals_fill_workflow(A):
    s = valid_current_investments_session(A)
    tf_res = fill_totals(s, CI_TABLE, "CY")
    assert "filled" in tf_res
    assert "columns" in tf_res


def test_upkeep_workflow(A):
    s = valid_current_investments_session(A)
    h_res = health_check(s, move=False)
    assert "statements" in h_res
    assert "cells" in h_res
