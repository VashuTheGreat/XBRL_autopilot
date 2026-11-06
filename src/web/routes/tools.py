"""Filing tools: health upkeep, carry-forward, totals-fill, comparison, Excel import, and PDF preview."""

from __future__ import annotations
import json
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, Body, UploadFile, File
from fastapi.responses import HTMLResponse

from src.web.state import get_session
from src.services.upkeep import health_check, hidden_data, restore_fact, delete_set_aside
from src.services.carry_forward import carry_forward_plan, carry_forward
from src.services.totals_fill import fill_totals_plan, fill_totals
from src.services.compare import compare_filings
from src.services.excel_import import parse_excel_workbook, statement_targets, suggest_excel_targets, excel_display_value
from src.services.pdf_preview import build_preview_html
from src.core.model import Filing
from src.services.importer import import_instance

router = APIRouter(prefix="/api/tools", tags=["tools"])


@router.get("/health")
def run_health(move: bool = Query(True), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    return health_check(s, move=move)


@router.get("/hidden")
def get_hidden_data(session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    return hidden_data(s)


@router.post("/restore")
def restore_set_aside(index: int = Body(..., embed=True), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    try:
        return restore_fact(s, index)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/set-aside/{index}")
def delete_set_aside_item(index: int, session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    try:
        return delete_set_aside(s, index)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/carry-forward/plan")
def get_cf_plan(table_id: str = Body(..., embed=True), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    return carry_forward_plan(s, table_id)


@router.post("/carry-forward")
def execute_cf(table_id: str = Body(...), values: bool = Body(False), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    try:
        return carry_forward(s, table_id, values=values)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/totals-fill/plan")
def get_totals_plan(table_id: str = Body(...), scope: str = Body("CY"), session_id: str = "default") -> List[Dict[str, Any]]:
    s = get_session(session_id)
    return fill_totals_plan(s, table_id, scope)


@router.post("/totals-fill")
def execute_totals_fill(table_id: str = Body(...), scope: str = Body("CY"), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    return fill_totals(s, table_id, scope)


@router.post("/compare")
async def compare_with_upload(file: UploadFile = File(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    content = (await file.read()).decode("utf-8")
    if file.filename.endswith(".json"):
        second_filing = Filing.from_json(s.A, json.loads(content))
    else:
        imp = import_instance(s.A, content, file_name=file.filename, year_mode="both")
        second_filing = imp["filing"]
    return compare_filings(s.A, s.filing, second_filing)


@router.post("/excel/parse")
async def parse_excel(file: UploadFile = File(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    data = await file.read()
    try:
        wb_data = parse_excel_workbook(data, periods=s.filing.meta.get("periods"))
        bs_targets = statement_targets(s.A, s, "balance")
        pl_targets = statement_targets(s.A, s, "profit-loss")
        targets = bs_targets + pl_targets

        mapped_rows = []
        for r in wb_data["rows"]:
            sugg = suggest_excel_targets(s.A, targets, r["lineItem"])
            mapped_rows.append({
                **r,
                "suggested": sugg[0]["concept"] if sugg else None,
                "targetOptions": [{"concept": t["concept"], "label": t["label"]} for t in targets],
            })

        return {"rows": mapped_rows, "ignoredSheets": wb_data["ignoredSheets"]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/excel/import")
def apply_excel_import(
    rows: List[Dict[str, Any]] = Body(...),
    source_level: str = Body("Actual"),
    session_id: str = "default",
) -> Dict[str, Any]:
    s = get_session(session_id)
    filing_level = s.filing.meta.get("level", "Actual")
    imported_count = 0
    errors = []

    for r in rows:
        concept = r.get("concept")
        if not concept:
            continue
        cy_val = r.get("cy")
        py_val = r.get("py")

        if cy_val is not None:
            try:
                display = excel_display_value(cy_val, concept, s.A, source_level, filing_level)
                s.set_value(concept, "CY", display, recalc=True)
                imported_count += 1
            except Exception as e:
                errors.append(f"CY {concept}: {e}")

        if py_val is not None and not s.filing.meta.get("firstFinancialYear"):
            try:
                display = excel_display_value(py_val, concept, s.A, source_level, filing_level)
                s.set_value(concept, "PY", display, recalc=True)
                imported_count += 1
            except Exception as e:
                errors.append(f"PY {concept}: {e}")

    return {"status": "ok", "imported": imported_count, "errors": errors, "revision": s.filing.revision}


@router.get("/preview/html", response_class=HTMLResponse)
def render_pdf_preview(session_id: str = "default"):
    s = get_session(session_id)
    html_content = build_preview_html(s)
    return HTMLResponse(content=html_content)
