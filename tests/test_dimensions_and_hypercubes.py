import pytest
from src.core.authority import get_authority
from src.core.dimensions import check_dimension_syntax, dimensionally_valid
from src.services.session import Session, DimensionError
from tests.fixtures import base_session


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_explicit_dimension_syntax(A):
    q = A.qname_of_local
    ta_classes = q("ClassesOfTangibleAssetsAxis")
    land = q("LandMember")

    # Valid member accepted
    assert check_dimension_syntax(A, [{"axis": ta_classes, "member": land}]) == []

    # Member not in domain
    codes = [e["code"] for e in check_dimension_syntax(A, [{"axis": ta_classes, "member": q("GoodwillMember")}])]
    assert "dim.memberNotInDomain" in codes

    # Default reported
    codes_def = [e["code"] for e in check_dimension_syntax(A, [{"axis": ta_classes, "member": q("CompanyTotalTangibleAssetsMember")}])]
    assert "dim.defaultReported" in codes_def

    # Duplicate axis
    codes_dup = [e["code"] for e in check_dimension_syntax(A, [{"axis": ta_classes, "member": land}, {"axis": ta_classes, "member": q("BuildingsMember")}])]
    assert "dim.duplicateAxis" in codes_dup

    # Unknown axis
    codes_unk = [e["code"] for e in check_dimension_syntax(A, [{"axis": "in-gaap:NoSuchAxis", "member": land}])]
    assert "dim.unknownAxis" in codes_unk


def test_typed_dimension_syntax(A):
    q = A.qname_of_local
    ax = q("CategoriesOfRelatedPartiesAxis")
    assert A.concept(ax)["kind"] == "typedAxis"

    # Valid typed value
    assert check_dimension_syntax(A, [{"axis": ax, "typed": "RelatedParty1"}]) == []

    # Empty typed value
    codes_empty = [e["code"] for e in check_dimension_syntax(A, [{"axis": ax, "typed": "  "}])]
    assert "dim.emptyTyped" in codes_empty

    # Typed axis with explicit member
    codes_typed_as_exp = [e["code"] for e in check_dimension_syntax(A, [{"axis": ax, "member": q("LandMember")}])]
    assert "dim.typedAsExplicit" in codes_typed_as_exp

    # Explicit axis with typed value
    codes_exp_as_typed = [e["code"] for e in check_dimension_syntax(A, [{"axis": q("ClassesOfTangibleAssetsAxis"), "typed": "x"}])]
    assert "dim.explicitAsTyped" in codes_exp_as_typed


def test_hypercube_validity(A):
    q = A.qname_of_local
    ta_classes = q("ClassesOfTangibleAssetsAxis")
    land = q("LandMember")

    # Closed 'all' table accepts its axes
    res = dimensionally_valid(A, q("TangibleAssets"), [{"axis": ta_classes, "member": land}])
    assert res["valid"], res.get("reason")

    # Rejects foreign axis
    res_foreign = dimensionally_valid(A, q("TangibleAssets"), [
        {"axis": ta_classes, "member": land},
        {"axis": q("ClassificationOfBorrowingsAxis"), "member": q("TermLoansMember")}
    ])
    assert not res_foreign["valid"]

    # Non-dimensional item with dimensions rejected
    assert not dimensionally_valid(A, q("RevenueFromOperations"), [{"axis": ta_classes, "member": land}])["valid"]
    # Non-dimensional item without dimensions accepted
    assert dimensionally_valid(A, q("RevenueFromOperations"), [])["valid"]


def test_session_rejects_dimensionally_invalid_writes(A):
    s = base_session(A)
    q = A.qname_of_local
    s.set_value(q("LongTermBorrowings"), "CY", "500")

    id_borrowings = "200300:ClassificationOfBorrowingsTable"
    with pytest.raises(DimensionError):
        s.set_table_value(id_borrowings, "CY", [{"axis": q("ClassificationBasedOnTimePeriodAxis"), "member": q("ClassificationBasedOnTimePeriodMember")}], q("Borrowings"), "1")

    with pytest.raises(DimensionError):
        s.set_table_value(id_borrowings, "CY", [{"axis": q("ClassesOfTangibleAssetsAxis"), "member": q("LandMember")}], q("Borrowings"), "1")
