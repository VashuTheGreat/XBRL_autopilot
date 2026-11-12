"""POST /api/v1/mapping/suggest: the workbook as the desktop app holds it, plus the filing's periods and memory."""
import datetime as dt
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field

MAX_SHEETS = 64
MAX_CELLS_PER_SHEET = 120_000  # the app shows the first 60,000 cells of a bigger sheet
MAX_MERGES_PER_SHEET = 20_000


class Cell(BaseModel):
    r: int = Field(ge=0)
    c: int = Field(ge=0)
    v: Union[str, float, bool]


class Merge(BaseModel):
    r1: int = Field(ge=0)
    c1: int = Field(ge=0)
    r2: int = Field(ge=0)
    c2: int = Field(ge=0)


class Sheet(BaseModel):
    name: str = Field(max_length=200)
    cells: list[Cell] = Field(max_length=MAX_CELLS_PER_SHEET)
    merges: list[Merge] = Field(default_factory=list, max_length=MAX_MERGES_PER_SHEET)


class Periods(BaseModel):
    cyEnd: dt.date
    pyEnd: Optional[dt.date] = None


class MemoryEntry(BaseModel):
    label: str = Field(max_length=500)
    concept: str = Field(max_length=300)
    approvals: int = Field(1, ge=1)


class SuggestOptions(BaseModel):
    useLlm: bool = False
    maxCandidates: int = Field(10, ge=1, le=25)


class SuggestRequest(BaseModel):
    taxonomy: Literal["ci_taxonomy", "ind_as_taxonomy"]
    sheets: list[Sheet] = Field(max_length=MAX_SHEETS)
    periods: Periods
    level: str = Field("Actual", max_length=20)
    memory: list[MemoryEntry] = Field(default_factory=list, max_length=20_000)
    options: SuggestOptions = Field(default_factory=SuggestOptions)


class ColumnSuggestItem(BaseModel):
    row: int
    label: str
    cy_cell: str
    py_cell: Optional[str] = None


class ColumnSuggestRequest(BaseModel):
    taxonomy: str = "ind_as_taxonomy"
    workbook: str
    sheet: str
    items: list[ColumnSuggestItem]
