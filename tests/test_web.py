import pytest
from fastapi.testclient import TestClient
from src.web.app import app


@pytest.fixture
def client():
    return TestClient(app)


def test_index_page(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "XBRL Autopilot" in response.text
    assert "Company & Periods" in response.text


def test_filing_overview_and_meta(client):
    res = client.get("/api/filing")
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert "meta" in payload["data"]
    assert "tabs" in payload["data"]

    patch = {"name": "Test Web Corp", "cin": "U99999MH2021PTC999999"}
    update_res = client.post("/api/filing/meta", json=patch)
    assert update_res.status_code == 200
    update_payload = update_res.json()
    assert update_payload["success"] is True
    assert update_payload["data"]["meta"]["name"] == "Test Web Corp"


def test_facts_tab_data(client):
    res = client.get("/api/facts/tab/100100")
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert "rows" in payload["data"]
    assert len(payload["data"]["rows"]) > 0


def test_facts_cell_editing(client):
    payload = {
        "concept": "in-gaap:CurrentInvestments",
        "scope": "CY",
        "display": "500000",
        "recalc": True,
    }
    res = client.post("/api/facts/value", json=payload)
    assert res.status_code == 200
    res_json = res.json()
    assert res_json["success"] is True
    assert res_json["data"]["fact"] is not None


def test_validation_endpoint(client):
    res = client.get("/api/validation")
    assert res.status_code == 200
    payload = res.json()
    assert payload["success"] is True
    assert "summary" in payload["data"]
    assert "issues" in payload["data"]


def test_tools_health_and_preview(client):
    h_res = client.get("/api/tools/health?move=false")
    assert h_res.status_code == 200
    h_payload = h_res.json()
    assert h_payload["success"] is True
    assert "statements" in h_payload["data"]

    p_res = client.get("/api/tools/preview/html")
    assert p_res.status_code == 200
    assert "<!doctype html>" in p_res.text


def test_export_xml_and_json(client):
    x_res = client.get("/api/filing/export/xml?allow_errors=true")
    assert x_res.status_code == 200
    assert "<xbrli:xbrl" in x_res.text
    assert x_res.headers.get("content-type") == "application/xml"

    j_res = client.get("/api/filing/export/json")
    assert j_res.status_code == 200
    assert "mca-ci-xbrl-project" in j_res.text
    assert j_res.headers.get("content-type") == "application/json"
