from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class ValidationFixRequest(BaseModel):
    issue: Dict[str, Any]
    chosen: Optional[List[Any]] = None


class ExplainMcaRequest(BaseModel):
    text: str
