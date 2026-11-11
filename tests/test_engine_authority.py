"""Engine authorities built from the official MCA taxonomies (ADR-0010) and the /{id}/authority route."""
import json

import pytest
from fastapi.testclient import TestClient

from api.app import app
from src.constants import CI_OUTPUT_JSON, INDAS_OUTPUT_JSON
from src.services.engine_authority.builder import build
from src.services.engine_authority.collation import locale_key
from src.services.engine_authority.specs import CI_2016, IND_AS_2017, SPECS

client = TestClient(app)


def load(spec):
    return json.loads(spec.output.read_text(encoding="utf-8"))


def test_collation_matches_javascript_locale_compare():
    # order printed by node: ['a','a_b','a-b','a1b','Aa','ab','aB','Ab','ab1'].sort((a, b) => a.localeCompare(b))
    words = ["ab1", "Ab", "aB", "ab", "Aa", "a1b", "a-b", "a_b", "a"]
    assert sorted(words, key=locale_key) == ["a", "a_b", "a-b", "a1b", "Aa", "ab", "aB", "Ab", "ab1"]


@pytest.mark.parametrize("spec", [CI_2016, IND_AS_2017], ids=lambda s: s.id)
def test_committed_authority_is_current_and_deterministic(spec):
    """Rebuilding from data/ gives exactly the committed file (run `make rebuild` after changing the builder)."""
    assert build(spec) == load(spec)


@pytest.mark.parametrize(
    "spec, concepts, elrs, tables",
    [(CI_2016, 3660, 47, 92), (IND_AS_2017, 5647, 66, 205)],
    ids=lambda v: getattr(v, "id", str(v)),
)
def test_inventory(spec, concepts, elrs, tables):
    a = load(spec)
    assert len(a["concepts"]) == concepts
    assert len(a["elrs"]) == elrs
    assert len(a["tables"]) == tables == a["meta"]["relationshipStats"]["all"]
    assert len(a["dimensionDefaults"]) == a["meta"]["relationshipStats"]["dimensionDefault"]
    assert a["meta"]["schemaRef"].startswith("https://www.mca.gov.in/V3XBRL/")
    assert a["meta"]["cinScheme"] == "http://www.mca.gov.in/CIN"
    presented = set(a["presentation"])
    for t in a["tables"]:
        assert t["lineItems"], t["id"]
        # every table is shown in a statement, except technical hypercubes whose ELR has no presentation
        # (Ind AS [900000] TypedDefault)
        assert t["presentationElr"] or t["elr"] not in presented, t["id"]


@pytest.mark.parametrize("spec, kb", [(CI_2016, CI_OUTPUT_JSON), (IND_AS_2017, INDAS_OUTPUT_JSON)], ids=["ci", "ind_as"])
def test_engine_and_browsing_see_the_same_taxonomy(spec, kb):
    """The statements and concepts the UI browses (knowledge base) are the ones the engine can file."""
    browse = json.loads(kb.read_text(encoding="utf-8"))
    engine = load(spec)
    assert set(browse["presentation"]) == set(engine["presentation"])
    assert set(browse["concepts"]) == set(engine["concepts"])


def test_ind_as_filing_dts_includes_the_in_ca_disclosures():
    a = load(IND_AS_2017)
    codes = {e["code"] for e in a["elrs"]}
    assert {"700100", "700300", "700400", "700500", "700600", "700700"} <= codes
    assert a["concepts"]["in-ca:NameOfCompany"]["labels"]["label"] == "Name of company"


def test_ci_validator_patch_accepts_the_v3_srn_format():
    a = load(CI_2016)
    srn = a["types"]["in-ca-types:SRNNumber"]
    assert srn["patterns"] == ["[A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]", "[A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9]"]
    assert [p["file"] for p in a["meta"]["validatorPatches"]] == ["IN-CA/in-ca-types-2016-03-31.xsd"]


@pytest.mark.parametrize("tid", list(SPECS))
def test_authority_route(tid):
    resp = client.get(f"/api/v1/taxonomies/{tid}/authority")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["meta"]["taxonomyId"] == tid
    assert body["data"]["meta"]["taxonomyHash"] == load(SPECS[tid])["meta"]["taxonomyHash"]


@pytest.mark.parametrize("tid", ["costing_taxonomy", "nope"])
def test_authority_route_without_engine_support(tid):
    resp = client.get(f"/api/v1/taxonomies/{tid}/authority")
    assert resp.status_code == 404
    assert resp.json()["success"] is False
