from __future__ import annotations
from typing import Any, List, Optional
from pydantic import BaseModel, Field


class RestoreSetAsideRequest(BaseModel):
    index: int = Field(..., ge=0)


class CarryForwardPlanRequest(BaseModel):
    table_id: str = Field(..., alias="tableId")

    model_config = {
        "populate_by_name": True,
    }


class CarryForwardExecuteRequest(BaseModel):
    table_id: str = Field(..., alias="tableId")
    values: bool = False

    model_config = {
        "populate_by_name": True,
    }


class TotalsFillPlanRequest(BaseModel):
    table_id: str = Field(..., alias="tableId")
    scope: str = "CY"

    model_config = {
        "populate_by_name": True,
    }


class TotalsFillExecuteRequest(BaseModel):
    table_id: str = Field(..., alias="tableId")
    scope: str = "CY"

    model_config = {
        "populate_by_name": True,
    }


class ExcelImportRow(BaseModel):
    concept: Optional[str] = None
    cy: Optional[Any] = None
    py: Optional[Any] = None
    lineItem: Optional[str] = None

    model_config = {
        "extra": "allow",
    }


class ExcelImportRequest(BaseModel):
    rows: List[ExcelImportRow]
    source_level: str = "Actual"
