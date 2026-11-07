from __future__ import annotations
import json
from typing import Optional
from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import Response

from src.core.logger import logger
from src.core.model import Filing
from src.services.example import build_example
from src.web.responses import success_response
from src.web.schemas.filing import FilingImportJson, FilingMetaPatch
from src.web.state import get_session, reset_session

router = APIRouter(prefix="/api/filing", tags=["filing"])


@router.get("")
def get_filing_overview(session_id: str = "default"):
    with logger.span("filing.get_overview", session_id=session_id):
        s = get_session(session_id)
        f = s.filing
        tabs = [
            {
                "uri": e["uri"],
                "code": e.get("code"),
                "title": e.get("title"),
                "group": e.get("group"),
                "applicableCY": s.elr_status(e["uri"], "CY")["applicable"],
                "applicablePY": s.elr_status(e["uri"], "PY")["applicable"],
            }
            for e in s.A.elrs
        ]
        data = {
            "meta": f.meta,
            "revision": f.revision,
            "factsCount": len(f.all()),
            "footnotesCount": len(f.footnotes),
            "setAsideCount": len(f.set_aside),
            "tabs": tabs,
        }
        return success_response(data=data, message="Filing overview retrieved successfully")


@router.post("/meta")
def update_meta(patch: FilingMetaPatch, session_id: str = "default"):
    with logger.span("filing.update_meta", session_id=session_id):
        s = get_session(session_id)
        patch_dict = patch.model_dump(exclude_unset=True)
        s.set_meta(patch_dict)
        logger.info("filing.meta_updated", session_id=session_id, updated_keys=list(patch_dict.keys()))
        return success_response(
            data={"meta": s.filing.meta, "revision": s.filing.revision},
            message="Filing metadata updated successfully",
        )


@router.post("/new", status_code=201)
def new_filing(session_id: str = "default"):
    with logger.span("filing.new", session_id=session_id):
        s = reset_session(session_id)
        logger.info("filing.reset", session_id=session_id)
        return success_response(
            data={"meta": s.filing.meta, "revision": s.filing.revision},
            message="New filing created successfully",
            status_code=201,
        )


@router.post("/example")
def load_example(session_id: str = "default"):
    with logger.span("filing.load_example", session_id=session_id):
        s = reset_session(session_id)
        build_example(s)
        facts_count = len(s.filing.all())
        logger.info("filing.example_loaded", session_id=session_id, facts_count=facts_count)
        return success_response(
            data={"meta": s.filing.meta, "revision": s.filing.revision, "factsCount": facts_count},
            message="Example filing loaded successfully",
        )


@router.get("/export/json")
def export_json(session_id: str = "default"):
    with logger.span("filing.export_json", session_id=session_id):
        s = get_session(session_id)
        data = s.filing.to_json()
        cin = s.filing.meta.get("cin") or "project"
        rep = s.filing.meta.get("reportType") or "Standalone"
        filename = f"{cin}_{rep}.mca-ci.json"
        content = json.dumps(data, indent=2)
        logger.info("filing.exported_json", session_id=session_id, filename=filename)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


@router.post("/import/json")
def import_json(payload: FilingImportJson, session_id: str = "default"):
    with logger.span("filing.import_json", session_id=session_id):
        s = get_session(session_id)
        data = payload.model_dump(exclude_unset=True)
        new_filing_obj = Filing.from_json(s.A, data)
        s.filing = new_filing_obj
        s._views.clear()
        facts_count = len(s.filing.all())
        logger.info("filing.imported_json", session_id=session_id, facts_count=facts_count)
        return success_response(
            data={"meta": s.filing.meta, "factsCount": facts_count},
            message="Filing imported successfully",
        )


@router.post("/preview/xml")
async def preview_xml_upload(file: UploadFile = File(...), session_id: str = "default"):
    with logger.span("filing.preview_xml", session_id=session_id, filename=file.filename):
        s = get_session(session_id)
        content = (await file.read()).decode("utf-8")
        rep = s.preview_xml(content, {"fileName": file.filename})
        return success_response(data=rep, message="XML preview generated successfully")


@router.post("/import/xml")
async def import_xml_upload(
    file: UploadFile = File(...),
    year_mode: str = Query("both", pattern="^(both|CY|PY)$"),
    cash_flow_method: Optional[str] = Query(None, pattern="^(Direct|Indirect)$"),
    session_id: str = "default",
):
    with logger.span("filing.import_xml", session_id=session_id, filename=file.filename, year_mode=year_mode):
        s = get_session(session_id)
        content = (await file.read()).decode("utf-8")
        rep = s.import_xml(
            content,
            {"fileName": file.filename, "yearMode": year_mode, "cashFlowMethod": cash_flow_method},
        )
        facts_count = len(s.filing.all())
        logger.info("filing.imported_xml", session_id=session_id, facts_count=facts_count)
        return success_response(
            data={"report": rep, "meta": s.filing.meta, "factsCount": facts_count},
            message="XML instance imported successfully",
        )


@router.get("/wizard/status")
def get_wizard_validation_status(session_id: str = "default"):
    """Runs internal pre-validation and groups issues for the unified XML generation wizard."""
    with logger.span("filing.wizard_status", session_id=session_id):
        s = get_session(session_id)
        val_res = dict(s.validate())
        issues = val_res.get("issues", [])

        from src.services.spreadsheet_service import get_workbook_session
        wsess = get_workbook_session(session_id)
        tag_map = getattr(wsess, "tag_mappings", {}) if wsess else {}

        # Concept to sheet & row index lookup
        concept_locs: Dict[str, Dict[str, Any]] = {}
        for (sheet_name, row_idx), tag in tag_map.items():
            c = tag.get("concept")
            if c and c not in concept_locs:
                concept_locs[c] = {"sheet": sheet_name, "rowIndex": row_idx, "label": tag.get("label")}

        blocking_errors = []
        warnings = []

        for idx, iss in enumerate(issues):
            sev = iss.get("severity", "ERROR")
            c = iss.get("concept")
            loc = concept_locs.get(c, {}) if c else {}

            structured_issue = {
                "id": f"ISSUE-{idx + 1}",
                "severity": sev,
                "code": iss.get("code", "GENERAL"),
                "message": iss.get("message", "Validation discrepancy observed"),
                "concept": c,
                "sheet": loc.get("sheet") or iss.get("sheet"),
                "rowIndex": loc.get("rowIndex") or iss.get("rowIndex"),
                "cellLabel": loc.get("label"),
                "ruleId": iss.get("ruleId"),
                "canAutoFix": iss.get("code") in ("schemaRef", "periods", "rounding"),
                "suggestedFix": (
                    "Click 'Jump to Cell' to navigate directly to the Excel line item."
                    if loc.get("sheet")
                    else "Review filing metadata or required disclosures in the active taxonomy."
                ),
            }

            if sev == "ERROR":
                blocking_errors.append(structured_issue)
            else:
                warnings.append(structured_issue)

        can_generate = len(blocking_errors) == 0
        taxonomy = getattr(s.A.meta, "taxonomyType", "ci") or "ci"

        return success_response(
            data={
                "canGenerate": can_generate,
                "blockingErrors": blocking_errors,
                "warnings": warnings,
                "totalBlocking": len(blocking_errors),
                "totalWarnings": len(warnings),
                "taxonomy": taxonomy,
                "disclaimer": "Internal application pre-validation completed. Final filing verification may be tested against the official MCA Validation Tool.",
            },
            message="Unified validation completed",
        )


@router.get("/export/xml")
def export_xml_file(allow_errors: bool = Query(True), session_id: str = "default"):
    with logger.span("filing.export_xml", session_id=session_id, allow_errors=allow_errors):
        s = get_session(session_id)
        res = s.export_xml({"allowErrors": allow_errors})
        cin = s.filing.meta.get("cin") or "filing"
        rep = s.filing.meta.get("reportType") or "Standalone"
        filename = f"{cin}_{rep}.xml"
        logger.info("filing.exported_xml", session_id=session_id, filename=filename)
        return Response(
            content=res["xml"],
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
