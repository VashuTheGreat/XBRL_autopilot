from src.services.session import Session
from src.services.example import complete_mandatory


def new_session(A, meta=None):
    init_meta = {
        "name": "Test Co",
        "cin": "U72200KA2010PTC123456",
        "reportType": "Standalone",
        "level": "Actual",
        "displayPlaces": 0,
        "periods": {
            "cy": {"start": "2016-04-01", "end": "2017-03-31"},
            "py": {"start": "2015-04-01", "end": "2016-03-31"},
        },
    }
    if meta:
        init_meta.update(meta)
    s = Session(A)
    s.set_meta(init_meta)
    return s


def base_session(A, meta=None):
    s = new_session(A, meta)
    complete_mandatory(s, name="Test Co")
    return s


def with_current_investments(s, cy=1000, py=800):
    q = s.A.qname_of_local
    s.set_value(q("CurrentInvestments"), "CY", str(cy))
    if py is not None:
        s.set_value(q("CurrentInvestments"), "PY", str(py))

    for local in ("CurrentAssets", "Assets", "TradePayables", "CurrentLiabilities", "EquityAndLiabilities"):
        s.set_value(q(local), "CY", str(cy))
        if py is not None:
            s.set_value(q(local), "PY", str(py))

    s.set_value(q("AggregateAmountOfQuotedCurrentInvestments"), "CY", "0")
    s.set_value(q("AggregateAmountOfUnquotedCurrentInvestments"), "CY", str(cy))
    s.set_value(q("AggregateProvisionForDiminutionInValueOfCurrentInvestments"), "CY", "0")
    if py is not None:
        s.set_value(q("AggregateAmountOfQuotedCurrentInvestments"), "PY", "0")
        s.set_value(q("AggregateAmountOfUnquotedCurrentInvestments"), "PY", str(py))
        s.set_value(q("AggregateProvisionForDiminutionInValueOfCurrentInvestments"), "PY", "0")
    return s


CI_TABLE = "200500:DetailsOfCurrentInvestmentsTable"


def current_investment_rows(s, rows=None):
    if rows is None:
        rows = {"CY": [("1", 1000)], "PY": [("1", 800)]}
    A = s.A
    q = A.qname_of_local
    axis = q("ClassificationOfCurrentInvestmentsAxis")
    for scope, item_list in rows.items():
        for member, amount in item_list:
            dims = [{"axis": axis, "typed": member}]
            s.set_table_value(CI_TABLE, scope, dims, q("TypeOfCurrentInvestments"), A.enumerations(q("TypeOfCurrentInvestments"))[0])
            s.set_table_value(CI_TABLE, scope, dims, q("ClassOfCurrentInvestments"), A.enumerations(q("ClassOfCurrentInvestments"))[0])
            s.set_table_value(CI_TABLE, scope, dims, q("CurrentInvestments"), str(amount))
            s.set_table_value(CI_TABLE, scope, dims, q("BasisOfValuationOfCurrentInvestments"), "Lower of cost and fair value")
            s.set_table_value(CI_TABLE, scope, dims, q("NameOfBodyCorporateInWhomInvestmentHasBeenMade"), "Alpha Mutual Fund")
    return s


def valid_current_investments_session(A, meta=None):
    return current_investment_rows(with_current_investments(base_session(A, meta)))
