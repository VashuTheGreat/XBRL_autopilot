"""API Routes for Project Save, Load, Bundle Export/Import, and Startup Lifecycle."""

from __future__ import annotations
import json
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, File, Form, Query, Response, UploadFile
from pydantic import BaseModel

from src.core.logger import logger
from src.services.project_service import (
    export_bundle,
    import_bundle,
    list_projects,
    load_project,
    save_project,
)
from src.services.spreadsheet_service import (
    get_live_financial_differences,
    get_sheet_data,
    parse_and_store_workbook,
)
from src.web.responses import error_response, success_response
from src.web.state import get_session

router = APIRouter()


class SaveProjectRequest(BaseModel):
    name: Optional[str] = None
    uiState: Optional[Dict[str, Any]] = None
    scheduleLinks: Optional[List[Dict[str, Any]]] = None
    autosaveSettings: Optional[Dict[str, Any]] = None


class AutoSaveProjectRequest(BaseModel):
    name: Optional[str] = None
    uiState: Optional[Dict[str, Any]] = None
    scheduleLinks: Optional[List[Dict[str, Any]]] = None
    autosaveSettings: Optional[Dict[str, Any]] = None


class DiscardRecoveryRequest(BaseModel):
    projectId: Optional[str] = None


class NewProjectRequest(BaseModel):
    name: str
    cin: str
    taxonomy: str = "ci"
    startDate: str = "2024-04-01"
    endDate: str = "2025-03-31"
    level: str = "Actual"
    reportType: str = "Standalone"


@router.get("")
@router.get("/list")
def get_project_list():
    """Lists all persistent saved projects in the repository."""
    with logger.span("projects.list"):
        projects = list_projects()
        return success_response(data=projects, message="Projects listed successfully")


@router.post("/save")
def save_current_project(payload: Optional[SaveProjectRequest] = None, session_id: str = "default"):
    """Saves the complete active filing state, workbook, tag mappings, and settings."""
    with logger.span("projects.save", session_id=session_id):
        s = get_session(session_id)
        custom_name = payload.name if payload else None
        ui_state = payload.uiState if payload else None
        schedule_links = payload.scheduleLinks if payload else None
        autosave_settings = payload.autosaveSettings if payload else None

        res = save_project(
            s,
            session_id=session_id,
            custom_name=custom_name,
            is_recovery=False,
            ui_state=ui_state,
            schedule_links=schedule_links,
            autosave_settings=autosave_settings,
        )
        return success_response(data=res, message=f"Project '{res['projectId']}' saved successfully")


@router.post("/autosave")
def autosave_current_project(payload: Optional[AutoSaveProjectRequest] = None, session_id: str = "default"):
    """Writes a temporary recovery snapshot without overwriting the user's primary project file."""
    with logger.span("projects.autosave", session_id=session_id):
        s = get_session(session_id)
        custom_name = payload.name if payload else None
        ui_state = payload.uiState if payload else None
        schedule_links = payload.scheduleLinks if payload else None
        autosave_settings = payload.autosaveSettings if payload else None

        res = save_project(
            s,
            session_id=session_id,
            custom_name=custom_name,
            is_recovery=True,
            ui_state=ui_state,
            schedule_links=schedule_links,
            autosave_settings=autosave_settings,
        )
        return success_response(data=res, message="Auto-save recovery snapshot created")


@router.post("/discard-recovery")
def discard_project_recovery(payload: Optional[DiscardRecoveryRequest] = None, session_id: str = "default"):
    """Deletes the temporary local recovery cache when user discards or cleanly exits."""
    pid = payload.projectId if payload and payload.projectId else None
    if not pid:
        s = get_session(session_id)
        from src.services.project_service import compute_project_id
        pid = compute_project_id(s)

    with logger.span("projects.discard_recovery", project_id=pid):
        from src.services.project_service import delete_recovery_cache
        deleted = delete_recovery_cache(pid)
        return success_response(data={"deleted": deleted}, message="Recovery cache cleaned up")


@router.post("/load/{project_id}")
def load_saved_project(
    project_id: str,
    from_recovery: bool = Query(False),
    session_id: str = "default",
):
    """Restores a saved project state from storage into the active session."""
    with logger.span("projects.load", project_id=project_id, session_id=session_id, from_recovery=from_recovery):
        try:
            s = get_session(session_id)
            res = load_project(s, project_id=project_id, session_id=session_id, from_recovery=from_recovery)
            diffs = get_live_financial_differences(s)
            return success_response(
                data={
                    **res,
                    "differences": diffs,
                    "meta": s.filing.meta,
                    "revision": s.filing.revision,
                },
                message=f"Project '{project_id}' loaded successfully",
            )
        except Exception as e:
            logger.exception("projects.load_failed", project_id=project_id)
            return error_response(message=f"Failed to load project: {e}", status_code=404)


@router.get("/export/{project_id}")
def download_project_bundle(project_id: str):
    """Downloads the .wxbrl project bundle archive."""
    with logger.span("projects.export_bundle", project_id=project_id):
        bundle_bytes = export_bundle(project_id)
        if not bundle_bytes:
            return error_response(message=f"Project bundle for '{project_id}' not found", status_code=404)

        return Response(
            content=bundle_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{project_id}.wxbrl"'},
        )


@router.post("/import")
async def upload_project_bundle(
    file: UploadFile = File(...),
    session_id: str = "default",
):
    """Imports an uploaded .wxbrl or .zip project bundle into active session."""
    with logger.span("projects.import_bundle", filename=file.filename, session_id=session_id):
        try:
            s = get_session(session_id)
            content = await file.read()
            res = import_bundle(s, content, session_id=session_id)
            diffs = get_live_financial_differences(s)
            return success_response(
                data={
                    **res,
                    "differences": diffs,
                    "meta": s.filing.meta,
                    "revision": s.filing.revision,
                },
                message=f"Project imported successfully from {file.filename}",
            )
        except Exception as e:
            logger.exception("projects.import_failed")
            return error_response(message=f"Failed to import project bundle: {e}", status_code=400)


@router.post("/new")
async def create_new_filing(
    name: str = Form(...),
    cin: str = Form(...),
    taxonomy: str = Form("ci"),
    start_date: str = Form("2024-04-01"),
    end_date: str = Form("2025-03-31"),
    level: str = Form("Actual"),
    report_type: str = Form("Standalone"),
    workbook: Optional[UploadFile] = File(None),
    session_id: str = "default",
):
    """Initializes a new filing session with master details and optional Excel file."""
    with logger.span("projects.create_new", name=name, cin=cin, taxonomy=taxonomy, session_id=session_id):
        # Reset or switch session to the requested taxonomy
        from src.web.state import reset_session
        s = reset_session(session_id, taxonomy=taxonomy)

        # Set filing metadata
        meta = {
            "name": name.strip(),
            "cin": cin.strip().upper(),
            "taxonomyType": taxonomy.lower(),
            "reportType": report_type,
            "level": level,
            "periods": {
                "currentYear": {"startDate": start_date, "endDate": end_date},
                "cy": {"start": start_date, "end": end_date},
            },
        }
        s.set_meta(meta)

        sheet_data = None
        if workbook and workbook.filename:
            wb_bytes = await workbook.read()
            parse_and_store_workbook(wb_bytes, workbook.filename, session_id=session_id)
            sheet_data = get_sheet_data(session_id)

        # Save initial snapshot
        saved_info = save_project(s, session_id=session_id, custom_name=name)

        return success_response(
            data={
                "projectId": saved_info["projectId"],
                "meta": s.filing.meta,
                "taxonomy": taxonomy,
                "sheet": sheet_data,
            },
            message="New filing created successfully",
        )
