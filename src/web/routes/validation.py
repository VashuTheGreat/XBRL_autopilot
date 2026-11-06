from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from src.core.logger import logger
from src.services.fixes import fix_for
from src.services.mca_errors import explain_mca_errors
from src.web.responses import success_response
from src.web.schemas.validation import ExplainMcaRequest, ValidationFixRequest
from src.web.state import get_session

router = APIRouter(prefix="/api/validation", tags=["validation"])


@router.get("")
def validate_filing(today: Optional[str] = Query(None), session_id: str = "default"):
    with logger.span("validation.validate_filing", today=today, session_id=session_id):
        s = get_session(session_id)
        res = dict(s.validate({"today": today}))
        if "emit" in res:
            res["emit"] = [f.to_dict() for f in res["emit"]]
        logger.info("validation.filing_validated", issues_count=len(res.get("issues", [])))
        return success_response(data=res, message="Filing validated successfully")


@router.get("/tab")
def validate_tab(elr_uri: str = Query(...), today: Optional[str] = Query(None), session_id: str = "default"):
    with logger.span("validation.validate_tab", elr_uri=elr_uri, today=today, session_id=session_id):
        s = get_session(session_id)
        res = dict(s.validate_tab(elr_uri, {"today": today}))
        if "emit" in res:
            res["emit"] = [f.to_dict() for f in res["emit"]]
        return success_response(data=res, message="Tab validated successfully")


@router.post("/fix")
def apply_fix(payload: ValidationFixRequest, session_id: str = "default"):
    with logger.span("validation.apply_fix", session_id=session_id):
        s = get_session(session_id)
        fix_obj = fix_for(s, payload.issue)
        if not fix_obj:
            raise HTTPException(status_code=400, detail="No automatic fix available for this issue")
        if fix_obj.get("disabled"):
            raise HTTPException(status_code=400, detail=fix_obj["disabled"])

        apply_fn = fix_obj.get("apply")
        if payload.chosen is not None:
            apply_fn(payload.chosen)
        else:
            apply_fn()

        label = fix_obj.get("label", "Unknown")
        logger.info("validation.fix_applied", label=label)
        return success_response(
            data={"revision": s.filing.revision},
            message=f"Applied fix: {label}",
        )


@router.post("/explain-mca")
def explain_mca(payload: ExplainMcaRequest, session_id: str = "default"):
    with logger.span("validation.explain_mca", session_id=session_id):
        s = get_session(session_id)
        results = explain_mca_errors(payload.text, s.A)
        return success_response(data=results, message="MCA errors explained successfully")
