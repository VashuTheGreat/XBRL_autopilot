import pytest
from fastapi.testclient import TestClient
from src.web.app import app


@pytest.fixture
def client():
    return TestClient(app)


def test_standardized_envelope_structure(client):
    res = client.get("/api/filing")
    assert res.status_code == 200
    data = res.json()
    assert "data" in data
    assert "message" in data
    assert "success" in data
    assert "errors" in data
    assert data["success"] is True
    assert data["errors"] is None
    assert isinstance(data["message"], str)


def test_correlation_id_header(client):
    res = client.get("/api/filing")
    assert "X-Request-ID" in res.headers
    assert len(res.headers["X-Request-ID"]) > 0

    custom_id = "test-custom-request-id-12345"
    res_custom = client.get("/api/filing", headers={"X-Request-ID": custom_id})
    assert res_custom.headers.get("X-Request-ID") == custom_id


def test_validation_error_handler_422(client):
    res = client.post("/api/facts/value", json={"recalc": "invalid_boolean_type"})
    assert res.status_code == 422
    data = res.json()
    assert data["success"] is False
    assert data["data"] is None
    assert data["message"] == "Request validation failed"
    assert isinstance(data["errors"], list)
    assert len(data["errors"]) > 0
    err = data["errors"][0]
    assert "field" in err
    assert "message" in err
    assert "type" in err


def test_not_found_error_handler_404(client):
    res = client.get("/api/facts/tab/non_existent_elr_uri_999999")
    assert res.status_code == 404
    data = res.json()
    assert data["success"] is False
    assert data["data"] is None
    assert data["message"] == "ELR not found"
    assert data["errors"] is None


def test_domain_error_handler_400(client):
    res = client.post("/api/facts/value", json={
        "concept": "in-gaap:CurrentInvestments",
        "scope": "CY",
        "display": "invalid_non_numeric_text",
        "recalc": True,
        "strict": True,
    })
    assert res.status_code == 400
    data = res.json()
    assert data["success"] is False
    assert data["data"] is None
    assert isinstance(data["message"], str)
    assert len(data["message"]) > 0


def test_tools_schemas_and_endpoints(client):
    plan_res = client.post("/api/tools/carry-forward/plan", json={"tableId": "200500:DetailsOfCurrentInvestmentsTable"})
    assert plan_res.status_code == 200
    data = plan_res.json()
    assert data["success"] is True
    assert "available" in data["data"]

    totals_res = client.post("/api/tools/totals-fill/plan", json={"tableId": "200500:DetailsOfCurrentInvestmentsTable", "scope": "CY"})
    assert totals_res.status_code == 200
    assert totals_res.json()["success"] is True

    restore_422 = client.post("/api/tools/restore", json={"index": -1})
    assert restore_422.status_code == 422


def test_non_json_endpoints_preserved(client):
    index_res = client.get("/")
    assert index_res.status_code == 200
    assert "text/html" in index_res.headers.get("content-type", "")

    preview_res = client.get("/api/tools/preview/html")
    assert preview_res.status_code == 200
    assert "text/html" in preview_res.headers.get("content-type", "")
    assert "<!doctype html>" in preview_res.text

    xml_res = client.get("/api/filing/export/xml?allow_errors=true")
    assert xml_res.status_code == 200
    assert xml_res.headers.get("content-type") == "application/xml"
    assert "<xbrli:xbrl" in xml_res.text
    assert "attachment" in xml_res.headers.get("content-disposition", "")

    json_export_res = client.get("/api/filing/export/json")
    assert json_export_res.status_code == 200
    assert json_export_res.headers.get("content-type") == "application/json"
    assert "mca-ci-xbrl-project" in json_export_res.text
    assert "attachment" in json_export_res.headers.get("content-disposition", "")
