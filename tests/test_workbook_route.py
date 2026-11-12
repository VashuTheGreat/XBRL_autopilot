"""/api/v1/workbooks/read: .xls (BIFF) workbooks read by python-calamine for the desktop app."""
import base64
from pathlib import Path

from fastapi.testclient import TestClient

from api.app import app

client = TestClient(app)
DATA = Path(__file__).resolve().parents[1] / "data"
DGPL = DATA / "BS DGPL Mar-2026-V1.xls"


def post(name: str, content: bytes):
    return client.post("/api/v1/workbooks/read", json={"fileName": name, "contentBase64": base64.b64encode(content).decode()})


def test_reads_the_dgpl_xls_like_the_xlsx_reader():
    resp = post(DGPL.name, DGPL.read_bytes())
    assert resp.status_code == 200, resp.text
    sheets = resp.json()["data"]["sheets"]
    names = [s["name"] for s in sheets]
    assert names[:3] == ["IND AS BS ", "IND AS P&L ", "Cash Flow Ind AS"]  # names kept exactly, trailing space too
    bs = sheets[0]
    at = {(c["r"], c["c"]): c["v"] for c in bs["cells"]}
    assert at[(0, 1)] == "DIXON GLOBAL PRIVATE LIMITED"
    headers = [c["v"] for c in bs["cells"] if c["r"] == 5]
    assert "As at 30Th SEPTEMBER,2019" in headers  # the stale header the app must not guess from
    assert any("31st March 2026" in h for h in headers)
    ppe = next(c["r"] for c in bs["cells"] if c["v"] == "Property, Plant & Equipment")
    assert 29706.449999999983 in [c["v"] for c in bs["cells"] if c["r"] == ppe]  # float noise kept: the app rounds
    ppe_cell = next(c for c in bs["cells"] if c["r"] == ppe and c["v"] == 29706.449999999983)
    assert ppe_cell.get("numFmt")  # xlrd BIFF XF number format attached (ADR-0013 step 6)
    assert "#,##0" in ppe_cell["numFmt"]
    assert {"r1": 96, "c1": 4, "r2": 97, "c2": 5} in bs["merges"]
    assert all(c["v"] not in ("", None) for c in bs["cells"])


def test_refuses_junk_and_bad_base64():
    assert post("x.xls", b"not a workbook").status_code == 422
    resp = client.post("/api/v1/workbooks/read", json={"fileName": "x.xls", "contentBase64": "@@@"})
    assert resp.status_code == 422
