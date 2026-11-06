"""Filing lifecycle, metadata, export, and import endpoints."""

from __future__ import annotations
import json
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Body
from fastapi.responses import Response, JSONResponse

from src.web.state import get_session, reset_session
from src.services.example import build_example
from src.core.model import Filing

router = APIRouter(prefix="/api/filing", tags=["filing"])


@router.get("")
def get_filing_overview(session_id: str = "default") -> Dict[str, Any]:
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
    return {
        "meta": f.meta,
        "revision": f.revision,
        "factsCount": len(f.all()),
        "footnotesCount": len(f.footnotes),
        "setAsideCount": len(f.set_aside),
        "tabs": tabs,
    }


@router.post("/meta")
def update_meta(patch: Dict[str, Any] = Body(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    s.set_meta(patch)
    return {"status": "ok", "meta": s.filing.meta, "revision": s.filing.revision}


@router.post("/new")
def new_filing(session_id: str = "default") -> Dict[str, Any]:
    s = reset_session(session_id)
    return {"status": "ok", "meta": s.filing.meta, "revision": s.filing.revision}


@router.post("/example")
def load_example(session_id: str = "default") -> Dict[str, Any]:
    s = reset_session(session_id)
    build_example(s)
    return {"status": "ok", "meta": s.filing.meta, "revision": s.filing.revision, "factsCount": len(s.filing.all())}


@router.get("/export/json")
def export_json(session_id: str = "default"):
    s = get_session(session_id)
    data = s.filing.to_json()
    cin = s.filing.meta.get("cin") or "project"
    rep = s.filing.meta.get("reportType") or "Standalone"
    filename = f"{cin}_{rep}.mca-ci.json"
    content = json.dumps(data, indent=2)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import/json")
def import_json(data: Dict[str, Any] = Body(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    try:
        new_filing_obj = Filing.from_json(s.A, data)
        s.filing = new_filing_obj
        s._views.clear()
        return {"status": "ok", "meta": s.filing.meta, "factsCount": len(s.filing.all())}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/preview/xml")
async def preview_xml_upload(file: UploadFile = File(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    content = (await file.read()).decode("utf-8")
    try:
        return s.preview_xml(content, {"fileName": file.filename})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import/xml")
async def import_xml_upload(
    file: UploadFile = File(...),
    year_mode: str = Query("both"),
    cash_flow_method: Optional[str] = Query(None),
    session_id: str = "default",
) -> Dict[str, Any]:
    s = get_session(session_id)
    content = (await file.read()).decode("utf-8")
    try:
        rep = s.import_xml(
            content,
            {"fileName": file.filename, "yearMode": year_mode, "cashFlowMethod": cash_flow_method},
        )
        return {"status": "ok", "report": rep, "meta": s.filing.meta, "factsCount": len(s.filing.all())}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/export/xml")
def export_xml_file(allow_errors: bool = Query(True), session_id: str = "default"):
    s = get_session(session_id)
    try:
        res = s.export_xml({"allowErrors": allow_errors})
        cin = s.filing.meta.get("cin") or "filing"
        rep = s.filing.meta.get("reportType") or "Standalone"
        filename = f"{cin}_{rep}.xml"
        return Response(
            content=res["xml"],
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
