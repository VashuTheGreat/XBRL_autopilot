"""Standard Project Storage and Session State Management Service.

Provides persistent multi-file project packages (manifest, filing facts,
original Excel workbook, tag mappings, and column gap settings)
with 1-click Save, Load, and Zip/Bundle archiving.
"""

from __future__ import annotations
import datetime
import io
import json
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
import zipfile

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


def save_project(
    filing_session: Any,
    session_id: str = "default",
    custom_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Saves the complete active filing state, tag mappings, settings, and Excel workbook."""
    meta = filing_session.filing.meta or {}
    company_name = custom_name or meta.get("name") or "Untitled_Filing"
    cin = meta.get("cin") or "NO_CIN"
    end_date = meta.get("periods", {}).get("currentYear", {}).get("endDate", "2025")
    
    slug_name = _safe_slug(company_name)[:30]
    slug_cin = _safe_slug(cin)[:21]
    project_id = f"{slug_name}_{slug_cin}_{end_date}"
    
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
        "workbookFilename": workbook_filename,
        "activeSheet": active_sheet,
        "totalTagged": len(tag_mappings_list),
        "colDiff": col_diff,
        "levelRounding": level_rounding,
        "createdAt": now_iso,
        "updatedAt": now_iso,
        "appVersion": "v15.2",
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

    # 4. Settings
    settings_data = {
        "colDiff": col_diff,
        "levelRounding": level_rounding,
        "detectedCols": detected_cols,
    }
    with open(proj_dir / "settings.json", "w", encoding="utf-8") as f:
        json.dump(settings_data, f, indent=2)

    # 5. Workbook (.xlsx)
    if workbook_bytes:
        with open(proj_dir / "workbook.xlsx", "wb") as f:
            f.write(workbook_bytes)

    # 6. Build bundle ZIP (.wxbrl)
    bundle_path = proj_dir / f"{project_id}.wxbrl"
    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(proj_dir / "manifest.json", arcname="manifest.json")
        zf.write(proj_dir / "filing_facts.json", arcname="filing_facts.json")
        zf.write(proj_dir / "tag_mappings.json", arcname="tag_mappings.json")
        zf.write(proj_dir / "settings.json", arcname="settings.json")
        if (proj_dir / "workbook.xlsx").exists():
            zf.write(proj_dir / "workbook.xlsx", arcname="workbook.xlsx")

    logger.info("project.saved", project_id=project_id, path=str(proj_dir))
    return {
        "projectId": project_id,
        "manifest": manifest,
        "bundlePath": str(bundle_path),
        "bundleName": f"{project_id}.wxbrl",
    }


def list_projects() -> List[Dict[str, Any]]:
    """Returns a list of all saved project manifests sorted by last saved date."""
    projects = []
    if not PROJECTS_DIR.exists():
        return []

    for entry in PROJECTS_DIR.iterdir():
        if entry.is_dir():
            manifest_file = entry / "manifest.json"
            if manifest_file.exists():
                try:
                    with open(manifest_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        data["folderName"] = entry.name
                        projects.append(data)
                except Exception:
                    pass

    projects.sort(key=lambda p: p.get("updatedAt", ""), reverse=True)
    return projects


def load_project(
    filing_session: Any,
    project_id: str,
    session_id: str = "default",
) -> Dict[str, Any]:
    """Restores the complete filing facts, Excel workbook, tag mappings, and settings."""
    proj_dir = PROJECTS_DIR / project_id
    if not proj_dir.exists():
        # Check if project_id is a partial name
        matches = [d for d in PROJECTS_DIR.iterdir() if d.is_dir() and project_id in d.name]
        if matches:
            proj_dir = matches[0]
            project_id = proj_dir.name
        else:
            raise ValueError(f"Project '{project_id}' not found in {PROJECTS_DIR}")

    manifest_file = proj_dir / "manifest.json"
    facts_file = proj_dir / "filing_facts.json"
    wb_file = proj_dir / "workbook.xlsx"
    tag_file = proj_dir / "tag_mappings.json"
    settings_file = proj_dir / "settings.json"

    if not manifest_file.exists() or not facts_file.exists():
        raise ValueError(f"Corrupted project directory: missing manifest or facts in {proj_dir}")

    with open(manifest_file, "r", encoding="utf-8") as f:
        manifest = json.load(f)

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

    # 4. Restore Settings
    if settings_file.exists():
        with open(settings_file, "r", encoding="utf-8") as f:
            settings_data = json.load(f)
            wsess.col_diff = settings_data.get("colDiff", 1)
            wsess.level_rounding = settings_data.get("levelRounding", "Actual")
            if manifest.get("activeSheet") in wsess.sheets and "detectedCols" in settings_data:
                wsess.sheets[manifest["activeSheet"]]["detectedCols"].update(
                    settings_data["detectedCols"]
                )

    logger.info("project.loaded", project_id=project_id, total_tagged=len(wsess.tag_mappings))
    return {
        "projectId": project_id,
        "manifest": manifest,
        "sheet": get_sheet_data(session_id, manifest.get("activeSheet")),
        "factsCount": len(filing_session.filing.all()),
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
