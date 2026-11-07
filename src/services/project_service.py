"""Standard Project Storage and Session State Management Service.

Provides persistent multi-file project packages (manifest, filing facts,
original Excel workbook, tag mappings, schedule links, UI state, and column settings)
with 1-click Save, Save As, Load, Zip/Bundle (.wxbrl) archiving, and temporary
recovery cache with auto-cleanup on save or discard.
"""

from __future__ import annotations
import datetime
import io
import json
import os
from pathlib import Path
import re
import shutil
from typing import Any, Dict, List, Optional
import zipfile

from src.constants import TAXONOMY_CI
from src.core.authority import get_authority
from src.core.logger import logger
from src.core.model import Filing
from src.services.spreadsheet_service import (
    WorkbookSession,
    get_sheet_data,
    get_workbook_session,
    parse_and_store_workbook,
    _WORKBOOK_SESSIONS,
)

ROOT_DIR = Path(__file__).resolve().parents[2]
PROJECTS_DIR = ROOT_DIR / "saved_projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_slug(text: str) -> str:
    slug = re.sub(r"[^\w\-_]", "_", text.strip())
    return re.sub(r"_+", "_", slug).strip("_") or "project"


def _recovery_dir_for(project_id: str) -> Path:
    return PROJECTS_DIR / f".recovery_{_safe_slug(project_id)}"


def delete_recovery_cache(project_id: str) -> bool:
    """Safely deletes local recovery cache directory when a user saves or discards."""
    rec_dir = _recovery_dir_for(project_id)
    if rec_dir.exists():
        try:
            shutil.rmtree(rec_dir)
            logger.info("project.recovery_deleted", project_id=project_id)
            return True
        except Exception as e:
            logger.warning("project.recovery_delete_error", error=str(e))
    return False


def has_recovery_snapshot(project_id: str) -> bool:
    """Checks if a recovery cache exists for this project."""
    rec_dir = _recovery_dir_for(project_id)
    return (rec_dir / "manifest.json").exists()


def compute_project_id(filing_session: Any, custom_name: Optional[str] = None) -> str:
    """Computes a standardized project directory slug based on company name, CIN, and period."""
    meta = filing_session.filing.meta or {}
    company_name = custom_name or meta.get("name") or "Untitled_Filing"
    cin = meta.get("cin") or "NO_CIN"
    end_date = meta.get("periods", {}).get("currentYear", {}).get("endDate", "2025")
    slug_name = _safe_slug(company_name)[:30]
    slug_cin = _safe_slug(cin)[:21]
    return f"{slug_name}_{slug_cin}_{end_date}"


def save_project(
    filing_session: Any,
    session_id: str = "default",
    custom_name: Optional[str] = None,
    is_recovery: bool = False,
    ui_state: Optional[Dict[str, Any]] = None,
    schedule_links: Optional[List[Dict[str, Any]]] = None,
    autosave_settings: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Saves the complete active filing state, tag mappings, settings, schedule links, and Excel workbook.

    If is_recovery is False, any existing recovery cache for this project is cleaned up.
    """
    meta = filing_session.filing.meta or {}
    company_name = custom_name or meta.get("name") or "Untitled_Filing"
    cin = meta.get("cin") or "NO_CIN"
    end_date = meta.get("periods", {}).get("currentYear", {}).get("endDate", "2025")
    taxonomy_type = meta.get("taxonomyType") or getattr(filing_session.A.meta, "taxonomyType", None) or getattr(filing_session.A, "taxonomy", None) or TAXONOMY_CI
    taxonomy_version = meta.get("taxonomyVersion") or filing_session.A.meta.get("taxonomyVersion", "2016")

    slug_name = _safe_slug(company_name)[:30]
    slug_cin = _safe_slug(cin)[:21]
    project_id = compute_project_id(filing_session, custom_name=custom_name)

    if is_recovery:
        proj_dir = _recovery_dir_for(project_id)
    else:
        proj_dir = PROJECTS_DIR / project_id

    proj_dir.mkdir(parents=True, exist_ok=True)

    wsess = get_workbook_session(session_id)

    # Extract workbook raw bytes
    workbook_bytes = b""
    workbook_filename = "workbook.xlsx"
    tag_mappings_list = []
    col_diff = 1
    level_rounding = meta.get("level", "Actual")
    detected_cols = {}
    active_sheet = "BS"

    if wsess:
        workbook_filename = wsess.filename or "workbook.xlsx"
        workbook_bytes = wsess.file_bytes
        col_diff = wsess.col_diff
        level_rounding = wsess.level_rounding or level_rounding
        if wsess.sheet_names:
            active_sheet = wsess.sheet_names[0]
            if active_sheet in wsess.sheets:
                detected_cols = wsess.sheets[active_sheet].get("detectedCols", {})

        for (sname, row_idx), mapping in wsess.tag_mappings.items():
            tag_mappings_list.append({
                "sheet": sname,
                "rowIndex": row_idx,
                **mapping,
            })

    if not workbook_bytes:
        sample_path = ROOT_DIR / "data" / "sample_financials.xlsx"
        if sample_path.exists():
            with open(sample_path, "rb") as f:
                workbook_bytes = f.read()

    # 1. Manifest
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    manifest = {
        "projectId": project_id,
        "companyName": company_name,
        "cin": cin,
        "financialYear": end_date,
        "taxonomyType": taxonomy_type,
        "taxonomyVersion": taxonomy_version,
        "workbookFilename": workbook_filename,
        "activeSheet": active_sheet,
        "totalTagged": len(tag_mappings_list),
        "colDiff": col_diff,
        "levelRounding": level_rounding,
        "isRecovery": is_recovery,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "appVersion": "v15.3",
        "autosaveSettings": autosave_settings or {"enabled": False, "intervalSec": 60},
    }
    with open(proj_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # 2. Filing Facts State
    facts_data = filing_session.filing.to_json()
    with open(proj_dir / "filing_facts.json", "w", encoding="utf-8") as f:
        json.dump(facts_data, f, indent=2)

    # 3. Tag Mappings
    with open(proj_dir / "tag_mappings.json", "w", encoding="utf-8") as f:
        json.dump({"mappings": tag_mappings_list}, f, indent=2)

    # 4. Schedule Links
    sch_links = schedule_links or getattr(wsess, "schedule_links", []) if wsess else []
    with open(proj_dir / "schedule_links.json", "w", encoding="utf-8") as f:
        json.dump({"scheduleLinks": sch_links}, f, indent=2)

    # 5. UI State
    state_payload = ui_state or {
        "activeSheet": active_sheet,
        "collapsedNodes": [],
        "selectedTreeConcept": None,
    }
    with open(proj_dir / "ui_state.json", "w", encoding="utf-8") as f:
        json.dump(state_payload, f, indent=2)

    # 6. Settings
    settings_data = {
        "colDiff": col_diff,
        "levelRounding": level_rounding,
        "detectedCols": detected_cols,
    }
    with open(proj_dir / "settings.json", "w", encoding="utf-8") as f:
        json.dump(settings_data, f, indent=2)

    # 7. Workbook (.xlsx)
    if workbook_bytes:
        with open(proj_dir / "workbook.xlsx", "wb") as f:
            f.write(workbook_bytes)

    # 8. Build bundle ZIP (.wxbrl) if not just a recovery snapshot
    bundle_path = None
    if not is_recovery:
        bundle_path = proj_dir / f"{project_id}.wxbrl"
        with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in proj_dir.iterdir():
                if item.is_file() and not item.name.endswith(".wxbrl"):
                    zf.write(item, arcname=item.name)

        # User has performed a full, authoritative save: delete local recovery cache!
        delete_recovery_cache(project_id)

    logger.info("project.saved", project_id=project_id, is_recovery=is_recovery)
    return {
        "projectId": project_id,
        "manifest": manifest,
        "bundlePath": str(bundle_path) if bundle_path else None,
        "bundleName": f"{project_id}.wxbrl" if bundle_path else None,
        "isRecovery": is_recovery,
    }


def list_projects() -> List[Dict[str, Any]]:
    """Returns a list of all saved project manifests sorted by last saved date."""
    projects = []
    if not PROJECTS_DIR.exists():
        return []

    for entry in PROJECTS_DIR.iterdir():
        if entry.is_dir() and not entry.name.startswith(".recovery_"):
            manifest_file = entry / "manifest.json"
            if manifest_file.exists():
                try:
                    with open(manifest_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        data["folderName"] = entry.name
                        data["hasRecovery"] = has_recovery_snapshot(data.get("projectId", entry.name))
                        projects.append(data)
                except Exception:
                    pass

    projects.sort(key=lambda p: p.get("updatedAt", ""), reverse=True)
    return projects


def load_project(
    filing_session: Any,
    project_id: str,
    session_id: str = "default",
    from_recovery: bool = False,
) -> Dict[str, Any]:
    """Restores the complete filing facts, Excel workbook, tag mappings, schedule links, and UI state."""
    if from_recovery:
        proj_dir = _recovery_dir_for(project_id)
    else:
        proj_dir = PROJECTS_DIR / project_id

    if not proj_dir.exists():
        # Check if project_id is a partial name
        matches = [d for d in PROJECTS_DIR.iterdir() if d.is_dir() and project_id in d.name and not d.name.startswith(".recovery_")]
        if matches:
            proj_dir = matches[0]
            project_id = proj_dir.name
        else:
            raise ValueError(f"Project '{project_id}' not found in {PROJECTS_DIR}")

    manifest_file = proj_dir / "manifest.json"
    facts_file = proj_dir / "filing_facts.json"
    wb_file = proj_dir / "workbook.xlsx"
    tag_file = proj_dir / "tag_mappings.json"
    sch_file = proj_dir / "schedule_links.json"
    ui_file = proj_dir / "ui_state.json"
    settings_file = proj_dir / "settings.json"

    if not manifest_file.exists() or not facts_file.exists():
        raise ValueError(f"Corrupted project directory: missing manifest or facts in {proj_dir}")

    with open(manifest_file, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # Ensure authority matches project's taxonomy
    proj_taxonomy = manifest.get("taxonomyType", TAXONOMY_CI)
    if getattr(filing_session, "A", None) is None or getattr(filing_session.A, "taxonomy", TAXONOMY_CI) != proj_taxonomy:
        filing_session.A = get_authority(taxonomy=proj_taxonomy)

    with open(facts_file, "r", encoding="utf-8") as f:
        facts_data = json.load(f)

    # 1. Restore Filing facts
    new_filing = Filing.from_json(filing_session.A, facts_data)
    filing_session.filing = new_filing
    filing_session._views.clear()

    # 2. Restore Excel Workbook
    workbook_bytes = b""
    if wb_file.exists():
        with open(wb_file, "rb") as f:
            workbook_bytes = f.read()
    else:
        sample_path = ROOT_DIR / "data" / "sample_financials.xlsx"
        if sample_path.exists():
            with open(sample_path, "rb") as f:
                workbook_bytes = f.read()

    wsess = parse_and_store_workbook(
        workbook_bytes,
        manifest.get("workbookFilename", "workbook.xlsx"),
        session_id=session_id,
    )

    # 3. Restore Tag Mappings
    if tag_file.exists():
        with open(tag_file, "r", encoding="utf-8") as f:
            mapping_data = json.load(f)
            wsess.tag_mappings.clear()
            for m in mapping_data.get("mappings", []):
                sname = m.get("sheet")
                row_idx = m.get("rowIndex")
                if sname and row_idx:
                    tag_copy = dict(m)
                    tag_copy.pop("sheet", None)
                    tag_copy.pop("rowIndex", None)
                    wsess.tag_mappings[(sname, row_idx)] = tag_copy

    # 4. Restore Schedule Links
    if sch_file.exists():
        with open(sch_file, "r", encoding="utf-8") as f:
            sch_data = json.load(f)
            wsess.schedule_links = sch_data.get("scheduleLinks", [])
    else:
        wsess.schedule_links = []

    # 5. Restore Settings
    if settings_file.exists():
        with open(settings_file, "r", encoding="utf-8") as f:
            settings_data = json.load(f)
            wsess.col_diff = settings_data.get("colDiff", 1)
            wsess.level_rounding = settings_data.get("levelRounding", "Actual")
            if manifest.get("activeSheet") in wsess.sheets and "detectedCols" in settings_data:
                wsess.sheets[manifest["activeSheet"]]["detectedCols"].update(
                    settings_data["detectedCols"]
                )

    # 6. Read UI State
    ui_state = {}
    if ui_file.exists():
        with open(ui_file, "r", encoding="utf-8") as f:
            ui_state = json.load(f)

    logger.info("project.loaded", project_id=project_id, total_tagged=len(wsess.tag_mappings))
    return {
        "projectId": project_id,
        "manifest": manifest,
        "sheet": get_sheet_data(session_id, manifest.get("activeSheet")),
        "factsCount": len(filing_session.filing.all()),
        "uiState": ui_state,
        "scheduleLinks": getattr(wsess, "schedule_links", []),
        "hasRecovery": has_recovery_snapshot(project_id),
    }


def export_bundle(project_id: str) -> Optional[bytes]:
    """Returns raw bytes of the project bundle (.wxbrl) file."""
    proj_dir = PROJECTS_DIR / project_id
    bundle_path = proj_dir / f"{project_id}.wxbrl"
    if bundle_path.exists():
        with open(bundle_path, "rb") as f:
            return f.read()

    # If zip not built, build on the fly
    if proj_dir.exists():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in proj_dir.iterdir():
                if item.is_file() and not item.name.endswith(".wxbrl"):
                    zf.write(item, arcname=item.name)
        return buf.getvalue()
    return None


def import_bundle(
    filing_session: Any,
    zip_bytes: bytes,
    session_id: str = "default",
) -> Dict[str, Any]:
    """Unpacks an uploaded .wxbrl or .zip bundle and loads it into active session."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        if "manifest.json" not in names or "filing_facts.json" not in names:
            raise ValueError("Invalid project package: manifest.json or filing_facts.json missing")

        manifest_data = json.loads(zf.read("manifest.json").decode("utf-8"))
        project_id = manifest_data.get("projectId") or f"imported_{int(datetime.datetime.now().timestamp())}"

        proj_dir = PROJECTS_DIR / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)

        for name in names:
            zf.extract(name, proj_dir)

    return load_project(filing_session, project_id, session_id=session_id)

