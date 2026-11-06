import pytest
from src.core.authority import get_authority
from src.services.session import Session, PyLockedError
from src.services.upkeep import (
    health_check,
    hidden_data,
    compare_with_filed,
    set_aside,
    restore_fact,
    delete_set_aside,
)
from tests.fixtures import base_session


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_previous_year_lock(A):
    q = A.qname_of_local
    s = base_session(A)
    bs_uri = A.elr_by_code("100100")["uri"]
    dt_q = q("DeferredTaxLiabilitiesNet")

    # Lock PY
    s.filing.meta["pyLocked"] = True

    with pytest.raises(PyLockedError):
        s.set_value(dt_q, "PY", "1", tab=bs_uri)

    # CY should still be allowed
    s.set_value(dt_q, "CY", "1", tab=bs_uri)

    # Unlock PY
    s.filing.meta["pyLocked"] = False
    s.set_value(dt_q, "PY", "999", tab=bs_uri, recalc=True)
    assert s.get_value(dt_q, "PY").value == "999"


def test_health_check_rederivation(A):
    q = A.qname_of_local
    s = base_session(A)
    bs_uri = A.elr_by_code("100100")["uri"]

    dt = q("DeferredTaxLiabilitiesNet")
    fx = q("ForeignCurrencyMonetaryItemTranslationDifferenceLiabilityAccount")
    ncl = q("NoncurrentLiabilities")

    s.set_value(dt, "CY", "100", tab=bs_uri, recalc=True)
    s.set_value(fx, "CY", "50", tab=bs_uri, recalc=True)
    assert s.get_value(ncl, "CY").value == "150"

    # Modify fact directly to create inconsistency
    fx_fact = s.get_value(fx, "CY")
    s.filing.set_fact(fx, fx_fact.period, fx_fact.dims, "70")

    h = health_check(s, move=False)
    # Health check should re-derive NCL
    assert s.get_value(ncl, "CY").value == "170"


def test_set_aside_and_hidden_data(A):
    q = A.qname_of_local
    s = base_session(A)
    dt = q("DeferredTaxLiabilitiesNet")

    s.set_value(dt, "CY", "123")
    f = s.get_value(dt, "CY")
    assert f is not None

    # Set aside fact
    set_aside(s, [{"fact": f, "reason": "userRemoved"}], "userRemoved")
    assert s.get_value(dt, "CY") is None

    hd = hidden_data(s)
    assert len(hd["setAside"]) >= 1
    assert any(x["concept"] == dt for x in hd["setAside"])

    # Restore fact
    idx = next(i for i, x in enumerate(s.filing.set_aside) if x["concept"] == dt)
    restore_fact(s, idx)
    assert s.get_value(dt, "CY") is not None
    assert s.get_value(dt, "CY").value == "123"
