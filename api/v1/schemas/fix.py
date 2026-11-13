from typing import Any, Dict
from pydantic import BaseModel, Field


class FixRequest(BaseModel):
    """Stub schema for fix requests while fix-agent is temporarily removed."""
    model_config = {"extra": "allow"}
