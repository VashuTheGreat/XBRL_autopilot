from pydantic import BaseModel, Field
from typing import Literal, Any, Optional

class RecommendSchema(BaseModel):
    keys: list[str]
    filter: Optional[dict] = None
    top_k: int = 3


class Meta(BaseModel):
    taxonomy: str = "ind_as"
    nature: Literal["Standalone", "Consolidated"] = "Standalone"
    startDate: str = "2025-04-01"
    endDate: str = "2026-03-31"
    unit: Literal["INR", "USD"] = "INR"
    decimals: str = "0"


class Signatories(BaseModel):
    din: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    name: Optional[str] = None
    designation: str = "Director"
    signingDate: Optional[str] = None


class Master(BaseModel):
    company: dict[str, Any]
    auditor: dict[str, Any]
    signatories: list[Signatories]


class Statements(BaseModel):
    balanceSheet: list[dict[str, Any]] = []
    profitLoss: list[dict[str, Any]] = []


class Table(BaseModel):
    table: str
    axis: str
    rows: list[dict[str, Any]]


class Note(BaseModel):
    concept: str
    content: str


class GenerateXML(BaseModel):
    meta: Meta
    master: Master
    statements: Statements
    tables: list[Table] = []
    notes: list[Note] = []
    unique_id: Optional[str] = None
