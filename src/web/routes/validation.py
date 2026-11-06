"""Validation, issue reporting, fixes execution, and MCA error explainer endpoints."""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, Body

from src.web.state import get_session
from src.services.fixes import fix_for
from src.services.mca_errors import explain_mca_errors

router = APIRouter(prefix="/api/validation", tags=["validation"])


@router.get("")
def validate_filing(today: Optional[str] = Query(None), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    res = dict(s.validate({"today": today}))
    if "emit" in res:
        res["emit"] = [f.to_dict() for f in res["emit"]]
    return res


@router.get("/tab")
def validate_tab(elr_uri: str = Query(...), today: Optional[str] = Query(None), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    res = dict(s.validate_tab(elr_uri, {"today": today}))
    if "emit" in res:
        res["emit"] = [f.to_dict() for f in res["emit"]]
    return res


@router.post("/fix")
def apply_fix(issue: Dict[str, Any] = Body(...), chosen: Optional[List[Any]] = Body(None), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    fix_obj = fix_for(s, issue)
    if not fix_obj:
        raise HTTPException(status_code=400, detail="No automatic fix available for this issue")
    if fix_obj.get("disabled"):
        raise HTTPException(status_code=400, detail=fix_obj["disabled"])

    apply_fn = fix_obj.get("apply")
    try:
        if chosen is not None:
            apply_fn(chosen)
        else:
            apply_fn()
        return {"status": "ok", "message": f"Applied fix: {fix_obj.get('label')}", "revision": s.filing.revision}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/explain-mca")
def explain_mca(payload: Dict[str, str] = Body(...), session_id: str = "default") -> List[Dict[str, Any]]:
    s = get_session(session_id)
    text = payload.get("text", "")
    return explain_mca_errors(text, s.A)
