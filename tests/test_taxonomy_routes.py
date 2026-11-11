"""API contract tests for /api/v1/taxonomies (knowledge_base-backed)."""
import pytest
from fastapi.testclient import TestClient

from api.app import app

client = TestClient(app)
PREFIX = "/api/v1/taxonomies"


def data(resp):
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    return body["data"]


def test_health_is_public():
    body = client.get("/health").json()
    assert body["status"] == "ok"


@pytest.mark.parametrize("tax, count, first", [("ci_taxonomy", 47, "100100"), ("ind_as_taxonomy", 66, "110000"), ("costing_taxonomy", 23, "100100")])
def test_elrs_for_every_taxonomy(tax, count, first):
    elrs = data(client.get(f"{PREFIX}/{tax}/elrs"))
    assert len(elrs) == count
    assert elrs[0]["code"] == first
    assert {"uri", "id", "code", "title", "group"} <= set(elrs[0])
    assert {e["group"] for e in elrs} <= {"Statements", "Notes", "Disclosures"}


def test_ind_as_grouping_uses_titles_not_codes():
    elrs = {e["code"]: e for e in data(client.get(f"{PREFIX}/ind_as_taxonomy/elrs"))}
    assert elrs["110000"]["group"] == "Statements"
    assert elrs["400200"]["group"] == "Statements"  # Statement of changes in equity
    assert elrs["400100"]["group"] == "Notes"
    assert elrs["700300"]["group"] == "Disclosures"


def test_ranked_search_summary():
    res = data(client.get(f"{PREFIX}/ci_taxonomy/concepts/search", params={"q": "share capital", "summary": True, "limit": 5}))
    assert res["total"] > 5
    top = res["items"][0]
    assert top["qname"] == "in-gaap:ShareCapital"
    assert top["periodType"] == "instant" and top["balance"] == "credit"
    assert "100100" in top["elrCodes"]


def test_search_keeps_the_original_shape_by_default():
    res = data(client.get(f"{PREFIX}/ci_taxonomy/concepts/search", params={"q": "ShareCapital", "limit": 3}))
    assert isinstance(res, list) and "labels" in res[0]


def test_concept_detail_with_rules():
    c = data(client.get(f"{PREFIX}/ci_taxonomy/concepts/in-gaap:ShareCapital", params={"include_rules": True}))
    assert c["qname"] == "in-gaap:ShareCapital"
    assert c["businessRules"]["mandatory"] is True
    assert any("mandatory" in r["ruleText"].lower() for r in c["businessRules"]["rules"])


def test_elr_tree_by_code():
    t = data(client.get(f"{PREFIX}/ci_taxonomy/elrs/100100/tree"))
    assert t["title"] == "Balance sheet" and t["group"] == "Statements"
    flat = []

    def walk(n):
        flat.append(n["qname"])
        for k in n["children"]:
            walk(k)

    for root in t["tree"]:
        walk(root)
    assert "in-gaap:ShareCapital" in flat


def test_role_detail_and_rules_routes_fixed():
    role = data(client.get(f"{PREFIX}/ci_taxonomy/roles/100100"))
    assert role["uri"].endswith("BalanceSheet")
    rules = data(client.get(f"{PREFIX}/ci_taxonomy/rules"))
    assert "rules" in rules  # used to return roles by mistake
    one = data(client.get(f"{PREFIX}/ci_taxonomy/business-rules/0"))
    assert one["index"] == 0


def test_unknown_things_are_404():
    assert client.get(f"{PREFIX}/nope/elrs").status_code == 404
    assert client.get(f"{PREFIX}/ci_taxonomy/elrs/999999/tree").status_code == 404
    assert client.get(f"{PREFIX}/ci_taxonomy/concepts/in-gaap:DoesNotExist").status_code == 404


def test_role_tree_route_by_role_id():
    """The team's /roles/{role_id}/tree route (build_role_tree): kept alongside /elrs/{code}/tree."""
    role_id = next(r["id"] for r in data(client.get(f"{PREFIX}/ci_taxonomy/roles")).values() if r.get("code") == "100100")
    body = client.get(f"{PREFIX}/ci_taxonomy/roles/{role_id}/tree").json()
    assert body["role"]["code"] == "100100"
    assert body["tree"] and body["tree"][0]["children"]
