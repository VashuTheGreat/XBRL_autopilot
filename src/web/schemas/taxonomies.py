from __future__ import annotations
from pydantic import BaseModel
from typing import Literal
from src.constants import IND_AS_TAXONOMY,CI_TAXONOMY,COSTING_TAXONOMY



class ADDTaxonomies(BaseModel):
    taxonomies: list[str]
    collections: Literal[IND_AS_TAXONOMY,CI_TAXONOMY,COSTING_TAXONOMY]


class RecommendTaxonomies(BaseModel):
    keys: list[str]
    collection: Literal[IND_AS_TAXONOMY, CI_TAXONOMY, COSTING_TAXONOMY] = CI_TAXONOMY


RecommentTaxonomies = RecommendTaxonomies


class TagRowRequest(BaseModel):
    sheet: str
    rowIndex: int
    concept: str
    label: str = ""
    cyCol: int
    pyCol: int
    noteCol: int | None = None
    rounding: str = "Actual"


class TagRowDeleteRequest(BaseModel):
    sheet: str
    rowIndex: int


class BatchApplyTagsRequest(BaseModel):
    sheet: str
    mappings: list[dict]
    cyCol: int
    pyCol: int
    noteCol: int | None = None
    rounding: str = "Actual"


class SheetSettingsRequest(BaseModel):
    sheet: str
    particularsCol: int = 1
    cyCol: int = 3
    colDiff: int = 1
    rounding: str = "Actual"

