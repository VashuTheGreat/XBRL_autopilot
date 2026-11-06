import pytest
from src.core.authority import get_authority
from src.services.session import Session
from src.services.example import build_example
from src.services.upkeep import health_check, hidden_data
from src.services.compare import compare_filings
from src.services.workspace import project_path, stamp_project, fy_label
from src.services.footnotes import add_footnote, list_footnotes, link_footnote
from src.services.pdf_preview import build_preview_html, group_in
from src.services.excel_import import normalize_excel_label, parse_excel_amount
from src.services.mca_errors import explain_mca_errors


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_session_and_example(A):
    s = Session(A)
    build_example(s)
    assert s.filing.meta["name"] == "Example Pvt Ltd (sample data)"
    assert s.filing.value(A.qname_of_local("NameOfCompany"), "CY") == "Example Pvt Ltd"
    assert len(s.filing.all()) > 20

    # test validation
    gate_res = s.validate()
    assert "issues" in gate_res

    # test export XML
    exp = s.export_xml({"allowErrors": True})
    assert "<xbrli:xbrl" in exp["xml"]


def test_upkeep_and_health(A):
    s = Session(A)
    build_example(s)
    h = health_check(s, move=False)
    assert "statements" in h
    assert "cells" in h

    hd = hidden_data(s)
    assert "setAside" in hd
    assert "notApplicable" in hd


def test_compare(A):
    s1 = Session(A)
    build_example(s1)
    s2 = Session(A)
    build_example(s2)

    diff = compare_filings(A, s1.filing, s2.filing)
    assert diff["counts"]["total"] == 0

    # Modify s2
    sc_q = A.qname_of_local("CurrentInvestments")
    s2.set_value(sc_q, "CY", "300000")
    diff2 = compare_filings(A, s1.filing, s2.filing)
    assert diff2["counts"]["changed"] > 0


def test_workspace_helpers():
    meta = {
        "name": "Tata Motors Ltd",
        "cin": "L28920MH1945PLC004520",
        "reportType": "Standalone",
        "periods": {"cy": {"start": "2025-04-01", "end": "2026-03-31"}},
    }
    assert fy_label(meta) == "2025-26"
    pp = project_path(meta)
    assert "Tata_Motors_Ltd" in pp["file"]

    data = {"meta": dict(meta)}
    stamp = stamp_project(data)
    assert stamp["n"] == 1
    assert "at" in stamp


def test_footnotes(A):
    s = Session(A)
    build_example(s)
    f = s.filing.all()[0]
    fn_id = add_footnote(s.filing, "Test footnote description", [f.key])
    assert fn_id == "fn1"

    fns = list_footnotes(s.filing)
    assert len(fns) == 1
    assert fns[0]["text"] == "Test footnote description"


def test_pdf_preview_and_grouping(A):
    s = Session(A)
    build_example(s)
    html = build_preview_html(s)
    assert "<!doctype html>" in html
    assert "Example Pvt Ltd" in html

    assert group_in("1000000") == "10,00,000"
    assert group_in("12345678.50") == "1,23,45,678.50"


def test_excel_helpers():
    assert normalize_excel_label("Trade & other Payables") == "trade and other payables"
    assert parse_excel_amount("(1,23,456.78)") == "-123456.78"
    assert parse_excel_amount("₹ 50,000") == "50000"


def test_mca_errors_explainer(A):
    err = "cvc-complex-type.2.4.a: Invalid content was found starting with element 'col'. One of '{thead, tbody, tfoot, tr}' is expected."
    ex = explain_mca_errors(err, A)
    assert len(ex) == 1
    assert ex[0]["code"] == "cvc-complex-type.2.4.a"
    assert "Word/Excel table structure" in ex[0]["cause"]
