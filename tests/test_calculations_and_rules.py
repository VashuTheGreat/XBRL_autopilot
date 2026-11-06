import pytest
from src.core.authority import get_authority
from src.core.model import Filing
from src.engine.rules import RuleEngine
from src.engine.calculation import calculation_networks, run_calculations, CalcStatus
from src.core.dimensions import nondim_allowed
import src.core.decimal as Dec
from tests.fixtures import base_session, with_current_investments


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_calculation_networks_and_tolerance(A):
    q = A.qname_of_local
    nets = calculation_networks(A)
    assert len(nets) > 0

    s = base_session(A, {"level": "Lakhs", "displayPlaces": 2})
    f = s.filing
    net = next((n for n in nets if n["parent"] == q("CurrentAssets")), None)
    assert net is not None

    p = f.period(q("CurrentAssets"), "CY")
    # Set child facts
    f.set_fact({
        "concept": q("CurrentInvestments"),
        "period": p,
        "dims": [],
        "value": "1234000",
        "decimals": "-3"
    })
    f.set_fact({
        "concept": q("Inventories"),
        "period": p,
        "dims": [],
        "value": "1000",
        "decimals": "-3"
    })
    # Set parent equal to sum (1235000)
    f.set_fact({
        "concept": q("CurrentAssets"),
        "period": p,
        "dims": [],
        "value": "1235000",
        "decimals": "-3"
    })

    res = [r for r in run_calculations(A, f) if r["elr"] == net["elr"] and r["parent"] == q("CurrentAssets")]
    assert len(res) >= 1
    assert res[0]["status"] == CalcStatus.PASS


def test_rule_mandatory_missing(A):
    q = A.qname_of_local
    s = base_session(A)
    engine = RuleEngine(A)

    r_tp = next((r for r in A.rules.get("rules", []) if r.get("subject") == q("TradePayables") and r.get("implementation") == "pattern:mandatory"), None)
    assert r_tp is not None

    res1 = engine.run(s.filing, {"today": "2017-06-30"})
    fails1 = [r for r in res1["results"] if r["ruleId"] == r_tp["id"] and r["status"] == "FAIL"]
    assert len(fails1) == 0

    # Remove TradePayables for PY
    fact_py = s.get_value(q("TradePayables"), "PY")
    if fact_py:
        s.filing.remove_fact(fact_py.key)

    res2 = engine.run(s.filing, {"today": "2017-06-30"})
    fails2 = [r for r in res2["results"] if r["ruleId"] == r_tp["id"] and r["status"] == "FAIL"]
    assert len(fails2) == 1
    assert fails2[0]["scope"] == "PY"


def test_rule_sign_gte0(A):
    q = A.qname_of_local
    s = base_session(A)
    engine = RuleEngine(A)

    s.set_value(q("LongTermBorrowings"), "CY", "-5")
    r_ltb = next((r for r in A.rules.get("rules", []) if r.get("subject") == q("LongTermBorrowings") and r.get("implementation") == "pattern:gte0"), None)
    assert r_ltb is not None

    res = engine.run(s.filing, {"today": "2017-06-30"})
    fails = [r for r in res["results"] if r["ruleId"] == r_tp_id(r_ltb) and r["status"] == "FAIL"]
    assert len(fails) >= 1


def r_tp_id(r):
    return r["id"]


def test_rule_compare_assets_equity_liabilities(A):
    q = A.qname_of_local
    s = base_session(A)
    engine = RuleEngine(A)

    s.set_value(q("Assets"), "CY", "10")
    s.set_value(q("EquityAndLiabilities"), "CY", "0")
    s.set_value(q("EquityAndLiabilities"), "PY", "0")

    r_eq = next((r for r in A.rules.get("rules", []) if r.get("subject") == q("EquityAndLiabilities") and r.get("implementation") == "pattern:eq-ref"), None)
    assert r_eq is not None

    res1 = engine.run(s.filing, {"today": "2017-06-30"})
    fails1 = [r for r in res1["results"] if r["ruleId"] == r_eq["id"] and r["status"] == "FAIL"]
    assert len(fails1) >= 1

    s.set_value(q("EquityAndLiabilities"), "CY", "10")
    res2 = engine.run(s.filing, {"today": "2017-06-30"})
    fails2 = [r for r in res2["results"] if r["ruleId"] == r_eq["id"] and r["status"] == "FAIL"]
    assert len(fails2) == 0


def test_rule_minority_interest_report_type(A):
    q = A.qname_of_local
    engine = RuleEngine(A)
    r_mi = next((r for r in A.rules.get("rules", []) if r.get("subject") == q("MinorityInterest")), None)
    assert r_mi is not None
    assert r_mi["implementation"] == "pattern:mandatory-consolidated"

    s_stand = base_session(A)
    res_stand = engine.run(s_stand.filing, {"today": "2017-06-30"})
    fails_stand = [r for r in res_stand["results"] if r["ruleId"] == r_mi["id"] and r["status"] == "FAIL"]
    assert len(fails_stand) == 0

    c_consol = base_session(A, {"reportType": "Consolidated"})
    for scope in ["CY", "PY"]:
        c_consol.set_value(q("MinorityInterest"), scope, "")

    res_consol = engine.run(c_consol.filing, {"today": "2017-06-30"})
    fails_consol = [r for r in res_consol["results"] if r["ruleId"] == r_mi["id"] and r["status"] == "FAIL"]
    assert len(fails_consol) == 2
