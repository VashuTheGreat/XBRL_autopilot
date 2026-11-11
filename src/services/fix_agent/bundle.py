"""The context bundle the desktop app sends with one problem (built by ContextBundleBuilder in Electron main).

No CIN, company name, PAN, DIN, people's names or addresses; text values at most 200 characters; text blocks only for
the problem's own fact (ADR-0012). privacy.py checks it again before anything goes to the LLM.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

MAX_TEXT = 200
MAX_FACTS = 400
MAX_SOURCES = 200

Scope = Literal["CY", "PY", "PYO", "OTHER"]


class CellRef(BaseModel):
    workbook: str = Field(max_length=200)
    sheet: str = Field(max_length=200)
    ref: str = Field(max_length=30)

    def key(self) -> str:
        return f"{self.workbook}|{self.sheet}|{self.ref}"


class Dim(BaseModel):
    axis: str = Field(max_length=300)
    member: str = Field(max_length=300)


class Fact(BaseModel):
    key: str = Field(max_length=1000)
    concept: str = Field(max_length=300)
    label: str = Field("", max_length=500)
    dataType: str = Field("string", max_length=30)
    scope: Optional[Scope] = None
    period: str = Field(max_length=40)  # "2026-03-31" or "2025-04-01..2026-03-31"
    dims: list[Dim] = Field(default_factory=list, max_length=10)
    # value as in the XML (amounts in rupees) and as presented in the filing's rounding level
    value: Optional[str] = Field(None, max_length=MAX_TEXT)
    display: Optional[str] = Field(None, max_length=MAX_TEXT)
    nil: bool = False
    decimals: Optional[str] = Field(None, max_length=10)
    origin: Optional[str] = Field(None, max_length=30)
    cell: Optional[CellRef] = None
    elrs: list[str] = Field(default_factory=list, max_length=40)


class Rule(BaseModel):
    id: str = Field(max_length=60)
    text: str = Field("", max_length=4000)
    implementation: Optional[str] = Field(None, max_length=200)
    ast: Optional[dict[str, Any]] = None


class Explanation(BaseModel):
    title: str = Field("", max_length=500)
    meaning: str = Field("", max_length=2000)
    cause: str = Field("", max_length=2000)
    fix: str = Field("", max_length=2000)


class Problem(BaseModel):
    id: str = Field(max_length=1000)
    severity: Literal["error", "warning", "info"]
    family: str = Field(max_length=30)
    code: str = Field(max_length=120)
    ruleId: Optional[str] = Field(None, max_length=60)
    message: str = Field(max_length=4000)
    elrCode: Optional[str] = Field(None, max_length=20)
    elrTitle: Optional[str] = Field(None, max_length=300)
    concept: Optional[str] = Field(None, max_length=300)
    scope: Optional[str] = Field(None, max_length=10)
    factKey: Optional[str] = Field(None, max_length=1000)
    cell: Optional[CellRef] = None
    rule: Optional[Rule] = None
    mcaText: Optional[str] = Field(None, max_length=4000)
    explanation: Optional[Explanation] = None


class Neighbour(BaseModel):
    ref: str = Field(max_length=30)
    value: Union[float, str, bool, None] = None
    column: Optional[str] = Field(None, max_length=10)  # CY / PY when the column's period is known


class SourceRow(BaseModel):
    cell: CellRef
    label: Optional[str] = Field(None, max_length=MAX_TEXT)
    value: Union[float, str, bool, None] = None
    # the other value cells of the same row (numbers only), with the period of their column when known
    neighbours: list[Neighbour] = Field(default_factory=list, max_length=40)


class Meta(BaseModel):
    reportType: Optional[str] = Field(None, max_length=40)
    cyStart: str = Field(max_length=10)
    cyEnd: str = Field(max_length=10)
    pyStart: Optional[str] = Field(None, max_length=10)
    pyEnd: Optional[str] = Field(None, max_length=10)
    level: str = Field("Actual", max_length=20)
    firstFinancialYear: bool = False


class Options(BaseModel):
    maxSteps: int = Field(6, ge=1, le=6)
    maxTokens: int = Field(24_000, ge=1_000, le=200_000)


class FixRequest(BaseModel):
    taxonomy: Literal["ci_taxonomy", "ind_as_taxonomy"]
    problem: Problem
    facts: list[Fact] = Field(default_factory=list, max_length=MAX_FACTS)
    sources: list[SourceRow] = Field(default_factory=list, max_length=MAX_SOURCES)
    meta: Meta
    options: Options = Field(default_factory=Options)
