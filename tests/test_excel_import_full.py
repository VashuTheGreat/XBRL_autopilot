import pytest
import io
import openpyxl
from src.core.authority import get_authority
from src.services.session import Session
from src.services.example import build_example
from src.services.excel_import import (
    normalize_excel_label,
    parse_excel_amount,
    excel_display_value,
    excel_import_readiness,
    statement_targets,
    suggest_excel_targets,
    parse_excel_workbook,
)


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_excel_amounts_and_labels():
    assert parse_excel_amount("12abc") is None
    assert parse_excel_amount("  ₹ 1,234.50 ") == "1234.50"
    assert parse_excel_amount("(50)") == "-50"
    assert normalize_excel_label("Trade & Payables") == "trade and payables"


def test_excel_display_value_and_target_suggestions(A):
    s = Session(A)
    build_example(s)
    targets = statement_targets(A, s, "balance")
    matches = suggest_excel_targets(A, targets, "Share Capital")
    assert any(x["concept"] == A.qname_of_local("ShareCapital") for x in matches)

    assert suggest_excel_targets(A, targets, "Share Cap") == []

    sc_q = A.qname_of_local("ShareCapital")
    assert excel_display_value("1.25", sc_q, A, "Lakhs", "Actual") == "125000"

    shares_q = A.qname_of_local("NumberOfSharesOutstanding")
    assert excel_display_value("1.25", shares_q, A, "Lakhs", "Actual") == "1.25"


def test_excel_import_readiness():
    rows = [{"cy": "1", "py": "2"}]
    assert excel_import_readiness({"cy": {}, "py": {}}, False, rows)["ready"] is False

    cy_only = {"cy": {"start": "2025-04-01", "end": "2026-03-31"}, "py": {}}
    assert excel_import_readiness(cy_only, False, rows)["ready"] is False

    r1 = excel_import_readiness(cy_only, True, rows)
    assert r1["ready"] is True
    assert r1["skipPrevious"] is True

    both = {**cy_only, "py": {"start": "2024-04-01", "end": "2025-03-31"}}
    r2 = excel_import_readiness(both, False, rows)
    assert r2["ready"] is True
    assert r2["skipPrevious"] is False


def test_parse_excel_workbook():
    wb = openpyxl.Workbook()
    ws_bs = wb.active
    ws_bs.title = "Balance Sheet"
    ws_bs.append(["Particulars", "Current Year", "Previous Year"])
    ws_bs.append(["Share Capital", 100, 90])
    ws_bs.append(["Trade payables", "(1,23,456.50)", "-"])

    ws_notes = wb.create_sheet(title="Notes")
    ws_notes.append(["Particulars", "Current Year"])
    ws_notes.append(["Anything", 1])

    out = io.BytesIO()
    wb.save(out)
    data = out.getvalue()

    parsed = parse_excel_workbook(data)
    assert [r["lineItem"] for r in parsed["rows"]] == ["Share Capital", "Trade payables"]
    assert parsed["rows"][0]["cy"] == "100"
    assert parsed["rows"][0]["py"] == "90"
    assert parsed["rows"][1]["cy"] == "-123456.50"
    assert parsed["rows"][1]["py"] is None
    assert "Notes" in parsed["ignoredSheets"]
