"""Tests for mapping endpoints: suggest_column and suggest."""
from fastapi.testclient import TestClient

from api.app import app

client = TestClient(app)

SAMPLE_BS_SHEET = {
    "name": "Balance Sheet",
    "cells": [
        {"r": 0, "c": 0, "v": "Balance Sheet"},
        {"r": 1, "c": 0, "v": "Particulars"},
        {"r": 1, "c": 2, "v": "31.03.2026"},
        {"r": 1, "c": 3, "v": "31.03.2025"},
        {"r": 2, "c": 0, "v": "Trade receivables"},
        {"r": 2, "c": 2, "v": 1250000},
        {"r": 2, "c": 3, "v": 1100000},
        {"r": 3, "c": 0, "v": "Cash and cash equivalents"},
        {"r": 3, "c": 2, "v": 450000},
        {"r": 3, "c": 3, "v": 320000},
    ],
    "merges": [],
}


def test_suggest_column_endpoint():
    payload = {
        "taxonomy": "ind_as_taxonomy",
        "workbook": "test.xlsx",
        "sheet": "Balance Sheet",
        "items": [
            {"row": 2, "label": "Trade payables", "cy_cell": "C3", "py_cell": "D3"},
            {"row": 3, "label": "   ", "cy_cell": "C4", "py_cell": "D4"},  # empty label skipped
            {"row": 4, "label": "Property, plant and equipment", "cy_cell": "C5", "py_cell": "D5"},
        ],
    }
    resp = client.post("/api/v1/mapping/suggest_column", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["total_items"] == 2
    assert data["matched_items"] >= 2
    by_ref = {s["cell"]["ref"]: s for s in data["suggestions"]}
    assert "C3" in by_ref
    assert "D3" in by_ref
    assert "payables" in by_ref["C3"]["concept"].lower()
    assert by_ref["C3"]["scope"] == "CY"
    assert by_ref["D3"]["scope"] == "PY"
    assert by_ref["C3"]["confidence"] >= 0.5


def test_suggest_sheet_endpoint():
    payload = {
        "taxonomy": "ind_as_taxonomy",
        "sheets": [SAMPLE_BS_SHEET],
        "periods": {"cyEnd": "2026-03-31", "pyEnd": "2025-03-31"},
        "level": "Actual",
        "memory": [],
    }
    resp = client.post("/api/v1/mapping/suggest", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert len(data["layout"]) == 1
    assert data["layout"][0]["sheet"] == "Balance Sheet"
    assert len(data["suggestions"]) > 0


def test_suggest_validation():
    payload = {
        "taxonomy": "costing_taxonomy",
        "sheets": [SAMPLE_BS_SHEET],
        "periods": {"cyEnd": "2026-03-31"},
    }
    assert client.post("/api/v1/mapping/suggest", json=payload).status_code == 422
    resp = client.post(
        "/api/v1/mapping/suggest",
        json={"taxonomy": "ind_as_taxonomy", "sheets": [{"name": "Empty", "cells": []}], "periods": {"cyEnd": "2026-03-31"}},
    )
    assert resp.status_code == 200 and resp.json()["data"]["suggestions"] == []
