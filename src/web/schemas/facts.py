from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class FactValueUpdate(BaseModel):
    concept: str
    scope: str = "CY"
    display: Optional[str] = None
    preferred_label: Optional[str] = Field(None, alias="preferredLabel")
    tab: Optional[str] = None
    recalc: bool = True
    override: bool = False
    unlock_py: bool = Field(False, alias="unlockPY")
    strict: bool = False

    model_config = {
        "populate_by_name": True,
    }


class TableCellValueUpdate(BaseModel):
    table_id: str = Field(..., alias="tableId")
    scope: str = "CY"
    dims: List[Dict[str, Any]] = Field(default_factory=list)
    concept: str
    display: Optional[str] = None
    preferred_label: Optional[str] = Field(None, alias="preferredLabel")
    recalc: bool = True
    override: bool = False
    lock_calculated: bool = Field(True, alias="lockCalculated")
    unlock_py: bool = Field(False, alias="unlockPY")
    strict: bool = False

    model_config = {
        "populate_by_name": True,
    }


class SuggestTypedRequest(BaseModel):
    table_id: str = Field(..., alias="tableId")
    scope: str = "CY"
    axis: str

    model_config = {
        "populate_by_name": True,
    }
