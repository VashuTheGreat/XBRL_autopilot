"""Test suite for WebXBRL workflow reproduction, spreadsheet service, and AI auto-tagging."""

import io
import openpyxl
import pytest
from fastapi.testclient import TestClient
from src.constants import CI_TAXONOMY, COSTING_TAXONOMY, IND_AS_TAXONOMY
from src.web.app import app


@pytest.fixture
def client():
    return TestClient(app)


def test_taxonomy_recommend_post_and_get(client):
    """Verify that both GET and POST return structured AI recommendations."""
    keys = ["Revenue from operations", "Share capital", "Trade payables"]

    # Test POST
    res_post = client.post(
        "/api/taxonomies/recommend",
        json={"keys": keys, "collection": CI_TAXONOMY},
    )
    assert res_post.status_code == 200
    payload_post = res_post.json()
    assert payload_post["success"] is True
    assert len(payload_post["data"]) == 3
    assert any("ShareCapital" in r["concept"] for r in payload_post["data"])
    assert any("RevenueFromOperations" in r["concept"] for r in payload_post["data"])

    # Test GET
    res_get = client.get(
        f"/api/taxonomies?collection={CI_TAXONOMY}&keys=Revenue+from+operations&keys=Share+capital",
    )
    assert res_get.status_code == 200
    payload_get = res_get.json()
    assert payload_get["success"] is True
    assert len(payload_get["data"]) == 2


def test_taxonomy_tree_and_search(client):
    """Verify presentation hierarchy tree generation and concept search."""
    tree_res = client.get("/api/taxonomies/tree?elr_uri=100100")
    assert tree_res.status_code == 200
    tree_data = tree_res.json()["data"]
    assert tree_data["elr"]["code"] == "100100"
    assert len(tree_data["items"]) > 0

    search_res = client.get("/api/taxonomies/search?q=capital")
    assert search_res.status_code == 200
    search_data = search_res.json()["data"]
    assert len(search_data) > 0
    assert any("Capital" in item["concept"] for item in search_data)


def test_workbook_upload_and_tagging_lifecycle(client):
    """Full lifecycle: create workbook -> upload -> sheet view -> tag row -> batch apply -> live diffs."""
    wb = openpyxl.Workbook()
    ws_bs = wb.active
    ws_bs.title = "BS"
    ws_bs.append(["Particulars", "Note", "31.03.2025", "31.03.2024"])
    ws_bs.append(["Share Capital", "1", "1000000", "500000"])
    ws_bs.append(["Reserves and surplus", "2", "200000", "100000"])
    ws_bs.append(["Long-term borrowings", "3", "300000", "200000"])
    ws_bs.append(["Trade payables", "4", "150000", "80000"])

    ws_pl = wb.create_sheet(title="PL")
    ws_pl.append(["Particulars", "Note", "31.03.2025", "31.03.2024"])
    ws_pl.append(["Revenue from operations", "5", "5000000", "4000000"])

    buf = io.BytesIO()
    wb.save(buf)
    excel_bytes = buf.getvalue()

    # 1. Upload workbook
    upload_res = client.post(
        "/api/tools/workbook/upload",
        files={"file": ("company_financials.xlsx", excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert upload_res.status_code == 200
    up_data = upload_res.json()["data"]
    assert up_data["summary"]["sheetNames"] == ["BS", "PL"]
    assert up_data["sheet"]["rowCount"] >= 5

    # 2. Get specific sheet data
    sheet_res = client.get("/api/tools/workbook/sheet?sheet=BS")
    assert sheet_res.status_code == 200
    sheet_data = sheet_res.json()["data"]
    assert sheet_data["currentSheet"] == "BS"

    # 3. Tag single row
    tag_res = client.post(
        "/api/taxonomies/tag-row",
        json={
            "sheet": "BS",
            "rowIndex": 2,
            "concept": "in-gaap:ShareCapital",
            "label": "Share Capital",
            "cyCol": 3,
            "pyCol": 4,
            "noteCol": 2,
            "rounding": "Actual",
        },
    )
    assert tag_res.status_code == 200
    tag_data = tag_res.json()["data"]
    assert tag_data["mapping"]["concept"] == "in-gaap:ShareCapital"
    assert tag_data["mapping"]["cy_val"] == "1000000"

    # 4. Batch apply recommendations
    batch_res = client.post(
        "/api/taxonomies/batch-apply",
        json={
            "sheet": "BS",
            "mappings": [
                {"rowIndex": 3, "concept": "in-gaap:ReservesAndSurplus", "label": "Reserves and surplus"},
                {"rowIndex": 4, "concept": "in-gaap:LongTermBorrowings", "label": "Long-term borrowings"},
            ],
            "cyCol": 3,
            "pyCol": 4,
            "noteCol": 2,
            "rounding": "Actual",
        },
    )
    assert batch_res.status_code == 200
    batch_data = batch_res.json()["data"]
    assert batch_data["appliedCount"] == 2

    # 5. Check live differences
    diff_res = client.get("/api/taxonomies/differences")
    assert diff_res.status_code == 200
    diff_data = diff_res.json()["data"]
    assert "balanceSheet" in diff_data
    assert "profitAndLoss" in diff_data

    # 6. Untag row
    untag_res = client.post(
        "/api/taxonomies/untag-row",
        json={"sheet": "BS", "rowIndex": 2},
    )
    assert untag_res.status_code == 200
    assert untag_res.json()["data"]["removed"] is True


def test_webxbrl_gap_settings_and_tree_scopes(client):
    """Verify gap setting updates, multi-scope trees (both), and auto-loaded sample workbook."""
    # Test setting column gap
    set_res = client.post(
        "/api/taxonomies/settings",
        json={
            "sheet": "BS",
            "particularsCol": 1,
            "cyCol": 3,
            "colDiff": 2,
            "rounding": "Thousands",
        },
    )
    assert set_res.status_code == 200
    s_data = set_res.json()["data"]
    assert s_data["colDiff"] == 2
    assert s_data["pyCol"] == 5

    # Test multi-scope tree ('both')
    both_res = client.get("/api/taxonomies/tree?elr_uri=both")
    assert both_res.status_code == 200
    b_data = both_res.json()["data"]
    assert b_data["elr"]["code"] == "Both"
    assert len(b_data["items"]) > 0

    # Test sample workbook auto-loaded
    from src.services.spreadsheet_service import _WORKBOOK_SESSIONS
    _WORKBOOK_SESSIONS.pop("default", None)
    sheet_res = client.get("/api/tools/workbook/sheet?sheet=BS%20Sch")
    assert sheet_res.status_code == 200
    sch_data = sheet_res.json()["data"]
    assert sch_data["currentSheet"] == "BS Sch"
    # Verify rows 81-83 exist and are tagged
    r81 = next((r for r in sch_data["rows"] if r["rowIndex"] == 81), None)
    assert r81 is not None
    assert r81["tagged"] is True
    assert r81["tagInfo"]["concept"] == "in-gaap:BalancesWithBanksInFixedDepositsWithBanks"


def test_project_save_load_and_bundle_lifecycle(client):
    """Verify standard project persistence: save -> list -> load -> export .wxbrl -> import."""
    # 1. Save active project
    save_res = client.post("/api/projects/save", json={"name": "Test Reliance Ltd"})
    assert save_res.status_code == 200
    save_data = save_res.json()["data"]
    project_id = save_data["projectId"]
    assert "Test_Reliance_Ltd" in project_id
    assert "manifest" in save_data

    # 2. List projects
    list_res = client.get("/api/projects/list")
    assert list_res.status_code == 200
    proj_list = list_res.json()["data"]
    assert any(p["projectId"] == project_id for p in proj_list)

    # 3. Load project
    load_res = client.post(f"/api/projects/load/{project_id}")
    assert load_res.status_code == 200
    load_data = load_res.json()["data"]
    assert load_data["manifest"]["projectId"] == project_id
    assert "differences" in load_data

    # 4. Export .wxbrl bundle
    export_res = client.get(f"/api/projects/export/{project_id}")
    assert export_res.status_code == 200
    assert export_res.headers["content-type"] == "application/zip"
    bundle_bytes = export_res.content
    assert len(bundle_bytes) > 0

    # 5. Import .wxbrl bundle
    import_res = client.post(
        "/api/projects/import",
        files={"file": (f"{project_id}.wxbrl", bundle_bytes, "application/zip")},
    )
    assert import_res.status_code == 200
    import_data = import_res.json()["data"]
    assert import_data["manifest"]["projectId"] == project_id

    # 6. Create New Filing
    new_res = client.post(
        "/api/projects/new",
        data={
            "name": "Tata Consumer Products",
            "cin": "L15491WB1962PLC031426",
            "start_date": "2024-04-01",
            "end_date": "2025-03-31",
            "level": "Lakhs",
            "report_type": "Standalone",
        },
    )
    assert new_res.status_code == 200
    new_data = new_res.json()["data"]
    assert new_data["meta"]["name"] == "Tata Consumer Products"
    assert new_data["meta"]["cin"] == "L15491WB1962PLC031426"

    # Cleanup test folders so saved_projects/ stays clean
    import shutil
    from src.services.project_service import PROJECTS_DIR
    for pid in [project_id, new_data.get("projectId")]:
        if pid and (PROJECTS_DIR / pid).exists():
            shutil.rmtree(PROJECTS_DIR / pid, ignore_errors=True)
