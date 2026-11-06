import pytest
from src.core.authority import get_authority
from src.services.mandatory_marks import mandatory_cell
from src.services.session import Session, ApplicabilityError
from src.core.views import build_elr_view
from tests.fixtures import base_session, with_current_investments, current_investment_rows, CI_TABLE


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_unconditional_and_report_type_mandatory(A):
    q = A.qname_of_local
    s = base_session(A)
    m = mandatory_cell(s, q("OtherIncome"), "CY")
    assert m["mandatory"] is True

    m_py = mandatory_cell(s, q("OtherIncome"), "PY")
    assert m_py["mandatory"] is True

    # MinorityInterest is not mandatory in Standalone
    assert mandatory_cell(s, q("MinorityInterest"), "CY")["mandatory"] is False

    # MinorityInterest is mandatory in Consolidated
    c = base_session(A, {"reportType": "Consolidated"})
    assert mandatory_cell(c, q("MinorityInterest"), "CY")["mandatory"] is True

    # In first financial year, PY is not mandatory
    first = base_session(A, {"firstFinancialYear": True})
    assert mandatory_cell(first, q("OtherIncome"), "PY")["mandatory"] is False


def test_conditional_mandatory(A):
    q = A.qname_of_local
    s = base_session(A)
    child = q("NumberOfSubsidiaryCompanies")

    # Set WhetherCompanyHasSubsidiaryCompanies to false
    s.set_value(q("WhetherCompanyHasSubsidiaryCompanies"), "CY", "false")
    assert mandatory_cell(s, child, "CY")["mandatory"] is False

    # Set WhetherCompanyHasSubsidiaryCompanies to true
    s.set_value(q("WhetherCompanyHasSubsidiaryCompanies"), "CY", "true")
    m = mandatory_cell(s, child, "CY")
    assert m["mandatory"] is True
    assert m.get("conditional") is True


def test_table_rows_mandatory_line_items(A):
    q = A.qname_of_local
    s = with_current_investments(base_session(A))
    dims = [{"axis": q("ClassificationOfCurrentInvestmentsAxis"), "typed": "1"}]

    rules = A.rules.get("rules", [])
    ml = next((r for r in rules if r["id"].startswith("ML-") and r.get("ast", {}).get("type") == "lineItemsMandatory" and CI_TABLE in r.get("ast", {}).get("tables", [])), None)
    assert ml is not None
    for c in ml["ast"]["concepts"]:
        assert mandatory_cell(s, c, "CY", dims, CI_TABLE)["mandatory"] is True


def test_release_200500_applicability(A):
    q = A.qname_of_local
    today = "2017-06-30"
    axis = q("ClassificationOfCurrentInvestmentsAxis")

    for scope in ["CY", "PY"]:
        # When CurrentInvestments = 0
        s = base_session(A)
        s.set_value(q("CurrentInvestments"), scope, "0")
        st = s.table_status(CI_TABLE, scope)
        assert st["applicable"] is False

        with pytest.raises(ApplicabilityError):
            s.open_table(CI_TABLE, scope)

        with pytest.raises(ApplicabilityError):
            s.set_table_value(CI_TABLE, scope, [{"axis": axis, "typed": "1"}], q("CurrentInvestments"), "1")

        # When CurrentInvestments > 0
        s_pos = with_current_investments(base_session(A))
        st_pos = s_pos.table_status(CI_TABLE, scope)
        assert st_pos["applicable"] is True
        assert st_pos["mandatory"] is True

        opened = s_pos.open_table(CI_TABLE, scope)
        assert opened["view"]["axes"][0]["axis"] == axis
        assert opened["view"]["axes"][0]["typed"] is True

        # Check row entry
        current_investment_rows(s_pos)
        f = s_pos.get_value(q("CurrentInvestments"), scope, [{"axis": axis, "typed": "1"}])
        assert f is not None
        assert f.dims == [{"axis": axis, "typed": "1"}]
        assert f.period["date"] == ("2017-03-31" if scope == "CY" else "2016-03-31")
