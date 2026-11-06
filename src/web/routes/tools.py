from __future__ import annotations
import json
from fastapi import APIRouter, File, Path, Query, UploadFile
from fastapi.responses import HTMLResponse

from src.core.logger import logger
from src.core.model import Filing
from src.services.carry_forward import carry_forward, carry_forward_plan
from src.services.compare import compare_filings
from src.services.excel_import import (
    excel_display_value,
    parse_excel_workbook,
    statement_targets,
    suggest_excel_targets,
)
from src.services.importer import import_instance
from src.services.pdf_preview import build_preview_html
from src.services.totals_fill import fill_totals, fill_totals_plan
from src.services.upkeep import (
    delete_set_aside,
    health_check,
    hidden_data,
    restore_fact,
)
from src.web.responses import success_response
from src.web.schemas.tools import (
    CarryForwardExecuteRequest,
    CarryForwardPlanRequest,
    ExcelImportRequest,
    RestoreSetAsideRequest,
    TotalsFillExecuteRequest,
    TotalsFillPlanRequest,
)
from src.web.state import get_session

router = APIRouter(prefix="/api/tools", tags=["tools"])


@router.get("/health")
def run_health(move: bool = Query(True), session_id: str = "default"):
    with logger.span("tools.health_check", move=move, session_id=session_id):
        s = get_session(session_id)
        data = health_check(s, move=move)
        return success_response(data=data, message="Health check completed successfully")


@router.get("/hidden")
def get_hidden_data(session_id: str = "default"):
    with logger.span("tools.get_hidden", session_id=session_id):
        s = get_session(session_id)
        data = hidden_data(s)
        return success_response(data=data, message="Hidden facts retrieved successfully")


@router.post("/restore")
def restore_set_aside(payload: RestoreSetAsideRequest, session_id: str = "default"):
    with logger.span("tools.restore_fact", index=payload.index, session_id=session_id):
        s = get_session(session_id)
        data = restore_fact(s, payload.index)
        logger.info("tools.fact_restored", index=payload.index)
        return success_response(data=data, message="Fact restored successfully")


@router.delete("/set-aside/{index}")
def delete_set_aside_item(index: int = Path(..., ge=0), session_id: str = "default"):
    with logger.span("tools.delete_set_aside", index=index, session_id=session_id):
        s = get_session(session_id)
        data = delete_set_aside(s, index)
        logger.info("tools.set_aside_deleted", index=index)
        return success_response(data=data, message="Set-aside item deleted successfully")


@router.post("/carry-forward/plan")
def get_cf_plan(payload: CarryForwardPlanRequest, session_id: str = "default"):
    with logger.span("tools.cf_plan", table_id=payload.table_id, session_id=session_id):
        s = get_session(session_id)
        data = carry_forward_plan(s, payload.table_id)
        return success_response(data=data, message="Carry forward plan generated successfully")


@router.post("/carry-forward")
def execute_cf(payload: CarryForwardExecuteRequest, session_id: str = "default"):
    with logger.span("tools.cf_execute", table_id=payload.table_id, values=payload.values, session_id=session_id):
        s = get_session(session_id)
        data = carry_forward(s, payload.table_id, values=payload.values)
        logger.info("tools.cf_completed", table_id=payload.table_id)
        return success_response(data=data, message="Carry forward executed successfully")


@router.post("/totals-fill/plan")
def get_totals_plan(payload: TotalsFillPlanRequest, session_id: str = "default"):
    with logger.span("tools.totals_plan", table_id=payload.table_id, scope=payload.scope, session_id=session_id):
        s = get_session(session_id)
        data = fill_totals_plan(s, payload.table_id, payload.scope)
        return success_response(data=data, message="Totals fill plan generated successfully")


@router.post("/totals-fill")
def execute_totals_fill(payload: TotalsFillExecuteRequest, session_id: str = "default"):
    with logger.span("tools.totals_execute", table_id=payload.table_id, scope=payload.scope, session_id=session_id):
        s = get_session(session_id)
        data = fill_totals(s, payload.table_id, payload.scope)
        logger.info("tools.totals_completed", table_id=payload.table_id, scope=payload.scope)
        return success_response(data=data, message="Totals filled successfully")


@router.post("/compare")
async def compare_with_upload(file: UploadFile = File(...), session_id: str = "default"):
    with logger.span("tools.compare_filings", filename=file.filename, session_id=session_id):
        s = get_session(session_id)
        content = (await file.read()).decode("utf-8")
        if file.filename.endswith(".json"):
            second_filing = Filing.from_json(s.A, json.loads(content))
        else:
            imp = import_instance(s.A, content, file_name=file.filename, year_mode="both")
            second_filing = imp["filing"]
        data = compare_filings(s.A, s.filing, second_filing)
        return success_response(data=data, message="Filings compared successfully")


@router.post("/excel/parse")
async def parse_excel(file: UploadFile = File(...), session_id: str = "default"):
    with logger.span("tools.excel_parse", filename=file.filename, session_id=session_id):
        s = get_session(session_id)
        data = await file.read()
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

        return success_response(
            data={"rows": mapped_rows, "ignoredSheets": wb_data["ignoredSheets"]},
            message="Excel parsed successfully",
        )


@router.post("/excel/import")
def apply_excel_import(payload: ExcelImportRequest, session_id: str = "default"):
    with logger.span("tools.excel_import", session_id=session_id):
        s = get_session(session_id)
        filing_level = s.filing.meta.get("level", "Actual")
        imported_count = 0
        errors = []

        for r in payload.rows:
            concept = r.concept
            if not concept:
                continue
            cy_val = r.cy
            py_val = r.py

            if cy_val is not None:
                try:
                    display = excel_display_value(cy_val, concept, s.A, payload.source_level, filing_level)
                    s.set_value(concept, "CY", display, recalc=True)
                    imported_count += 1
                except Exception as e:
                    errors.append(f"CY {concept}: {e}")

            if py_val is not None and not s.filing.meta.get("firstFinancialYear"):
                try:
                    display = excel_display_value(py_val, concept, s.A, payload.source_level, filing_level)
                    s.set_value(concept, "PY", display, recalc=True)
                    imported_count += 1
                except Exception as e:
                    errors.append(f"PY {concept}: {e}")

        logger.info("tools.excel_imported", imported_count=imported_count, error_count=len(errors))
        return success_response(
            data={"imported": imported_count, "errors": errors, "revision": s.filing.revision},
            message="Excel data imported successfully",
        )


@router.get("/preview/html", response_class=HTMLResponse)
def render_pdf_preview(session_id: str = "default"):
    with logger.span("tools.render_preview", session_id=session_id):
        s = get_session(session_id)
        html_content = build_preview_html(s)
        return HTMLResponse(content=html_content)
