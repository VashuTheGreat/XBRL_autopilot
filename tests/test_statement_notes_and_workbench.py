import pytest
from src.core.authority import get_authority
from src.core.derived import statement_note_links
from src.services.session import Session, CalculatedCellError
from tests.fixtures import base_session, new_session


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_statement_note_links(A):
    q = A.qname_of_local
    links = statement_note_links(A)

    for l in [
        "ShareCapital", "ReservesAndSurplus", "LongTermBorrowings", "ShortTermBorrowings",
        "LongTermProvisions", "ShortTermProvisions", "TangibleAssets", "IntangibleAssets",
        "TradeReceivables", "CurrentInvestments", "NoncurrentInvestments", "Inventories",
        "OtherCurrentLiabilities", "CashAndBankBalances", "OtherIncome",
        "EmployeeBenefitExpense", "FinanceCosts", "OtherExpenses"
    ]:
        assert q(l) in links, f"{l} should be in statement_note_links"

    for l in [
        "ProfitLossForPeriod", "Assets", "CurrentAssets", "EquityAndLiabilities",
        "DeferredTaxLiabilitiesNet", "Revenue"
    ]:
        assert q(l) not in links, f"{l} should not be in statement_note_links"


def test_statement_cells_locked_unless_override(A):
    q = A.qname_of_local
    s = new_session(A)
    bs_uri = A.elr_by_code("100100")["uri"]

    # Trying to set ReservesAndSurplus on BS without override raises CalculatedCellError
    with pytest.raises(CalculatedCellError):
        s.set_value(q("ReservesAndSurplus"), "CY", "10", tab=bs_uri)

    # With override=True, it succeeds
    s.set_value(q("ReservesAndSurplus"), "CY", "10", tab=bs_uri, override=True, recalc=True)
    val = s.get_value(q("ReservesAndSurplus"), "CY")
    assert val is not None
    assert val.origin == "override"


def test_reserves_and_surplus_cascades_from_note(A):
    q = A.qname_of_local
    s = new_session(A)
    res_table = "200200:StatementOfChangesInReservesTable"
    ax = q("ComponentsOfReservesAxis")
    cr_mem = q("CapitalReservesMember")

    # Set table value in note
    s.set_table_value(
        res_table,
        "CY",
        [{"axis": ax, "member": cr_mem}],
        q("Reserves"),
        "300",
        preferred_label="periodEndLabel",
        recalc=True,
        lock_calculated=True,
    )

    # ReservesAndSurplus should now be calculated and equal 300
    res_val = s.get_value(q("ReservesAndSurplus"), "CY")
    assert res_val is not None
    assert res_val.value == "300"
    assert res_val.origin == "calculated"
