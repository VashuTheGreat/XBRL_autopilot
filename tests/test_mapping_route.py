"""POST /api/v1/mapping/suggest: contract, validation, and that the LLM stays off unless asked for and configured."""
from fastapi.testclient import TestClient

from api.app import app
from tests.test_tagging import BS

client = TestClient(app)


def body(**over):
    b = {
        "taxonomy": "ind_as_taxonomy",
        "sheets": [BS],
        "periods": {"cyEnd": "2026-03-31", "pyEnd": "2025-03-31"},
        "level": "Lakhs",
        "memory": [{"label": "Other Current Assets", "concept": "ind-as:OtherCurrentAssets", "approvals": 2}],
    }
    b.update(over)
    return b


def test_suggest_returns_layout_and_suggestions():
    resp = client.post("/api/v1/mapping/suggest", json=body())
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["layout"][0] == {
        "sheet": "Balance Sheet", "kind": "balance_sheet", "scale": "Lakhs",
        "periodColumns": {"CY": "E", "PY": "F"}, "rows": data["layout"][0]["rows"], "note": None,
    }
    by_ref = {s["cell"]["ref"]: s for s in data["suggestions"]}
    tr = by_ref["E13"]
    assert tr["concept"] == "ind-as:TradeReceivablesCurrent" and tr["scope"] == "CY" and tr["dims"] == []
    assert tr["origin"] == "exact" and tr["confidence"] >= 0.9 and tr["sign"] == 1
    assert {"concept", "label", "score"} <= set(tr["alternatives"][0])
    assert by_ref["E14"]["origin"] == "memory"
    assert data["llmUsed"] is False


def test_llm_needs_a_key_even_when_asked(monkeypatch):
    from src.app_config import get_app_config

    monkeypatch.setattr(get_app_config(), "groq_api_key", None)
    resp = client.post("/api/v1/mapping/suggest", json=body(options={"useLlm": True}))
    assert resp.status_code == 200 and resp.json()["data"]["llmUsed"] is False


def test_suggest_validation():
    assert client.post("/api/v1/mapping/suggest", json=body(taxonomy="costing_taxonomy")).status_code == 422
    assert client.post("/api/v1/mapping/suggest", json=body(periods={"cyEnd": "31/03/2026"})).status_code == 422
    resp = client.post("/api/v1/mapping/suggest", json=body(sheets=[{"name": "Empty", "cells": []}]))
    assert resp.status_code == 200 and resp.json()["data"]["suggestions"] == []
