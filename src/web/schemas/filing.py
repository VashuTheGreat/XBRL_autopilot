from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class FilingMetaPatch(BaseModel):
    cin: Optional[str] = None
    name: Optional[str] = None
    reportType: Optional[str] = None
    nature: Optional[str] = None
    level: Optional[str] = None
    firstFinancialYear: Optional[bool] = None
    dateOfStartOfFinancialYear: Optional[str] = None
    dateOfEndOfFinancialYear: Optional[str] = None
    dateOfBoardMeeting: Optional[str] = None
    dateOfAuditReport: Optional[str] = None
    dateOfAGM: Optional[str] = None

    model_config = {
        "extra": "allow",
        "populate_by_name": True,
    }


class FilingImportJson(BaseModel):
    format: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    facts: Optional[Dict[str, Any]] = None
    footnotes: Optional[List[Any]] = None
    setAside: Optional[List[Any]] = None

    model_config = {
        "extra": "allow",
        "populate_by_name": True,
    }
