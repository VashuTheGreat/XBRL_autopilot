import pytest
from src.core.authority import get_authority
from src.core.dimensions import dimensionally_valid, check_dimension_syntax, nondim_allowed
from src.core.model import Filing, FactValueError
from src.core.views import build_elr_view, build_table_view, total_column_allowed
from src.core.derived import derivations, statement_note_links


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_authority_loaded(A):
    assert A is not None
    assert len(A.concepts) > 3000
    assert len(A.tables) > 50
    assert len(A.elrs) > 20

    # check concept lookup
    cin_q = A.qname_of_local("CorporateIdentityNumber")
    assert cin_q is not None
    assert A.concept(cin_q) is not None
    assert not A.is_numeric(cin_q)

    # check monetary concept
    sc_q = A.qname_of_local("ShareCapital")
    assert sc_q is not None
    assert A.is_numeric(sc_q)
    assert A.is_monetary(sc_q)


def test_dimensions(A):
    sc_q = A.qname_of_local("ShareCapital")
    assert nondim_allowed(A, sc_q)

    # check valid and invalid dimension syntax
    errs = check_dimension_syntax(A, [{"axis": "invalid:Axis", "member": "invalid:Member"}])
    assert len(errs) > 0
    assert any(e["code"] == "dim.unknownAxis" for e in errs)


def test_model_filing(A):
    filing = Filing(A, {
        "name": "Test Company",
        "cin": "U12345MH2020PTC123456",
        "periods": {
            "cy": {"start": "2025-04-01", "end": "2026-03-31"},
            "py": {"start": "2024-04-01", "end": "2025-03-31"},
        },
        "level": "Actual",
        "displayPlaces": 2,
    })
    assert filing.periods_valid()

    sc_q = A.qname_of_local("ShareCapital")
    p_cy = filing.period(sc_q, "CY")
    assert p_cy == {"type": "instant", "date": "2026-03-31"}

    fact = filing.set_display_value(sc_q, p_cy, "100000.00")
    assert fact is not None
    assert fact.value == "100000"
    assert fact.decimals == "2"

    assert filing.value(sc_q, "CY") == "100000"

    # test JSON serialization round trip
    json_data = filing.to_json()
    assert json_data["format"] == "mca-ci-xbrl-project"
    restored = Filing.from_json(A, json_data)
    assert restored.value(sc_q, "CY") == "100000"


def test_views_and_derivations(A):
    # ELR 100100 is Balance Sheet
    bs_elr = A.elr_by_code("100100")
    assert bs_elr is not None
    view = build_elr_view(A, bs_elr["uri"])
    assert len(view["rows"]) > 0

    # check derivations
    d = derivations(A)
    assert "arith" in d
    assert "byClosing" in d

    links = statement_note_links(A)
    assert len(links) > 0
