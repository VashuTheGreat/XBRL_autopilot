from __future__ import annotations
from pydantic import BaseModel
from typing import Literal
from src.constants import IND_AS_TAXONOMY,CI_TAXONOMY,COSTING_TAXONOMY



class ADDTaxonomies(BaseModel):
    taxonomies: list[str]
    collections: Literal[IND_AS_TAXONOMY,CI_TAXONOMY,COSTING_TAXONOMY]


class RecommendTaxonomies(BaseModel):
    keys: list[str]
    collection: Literal[IND_AS_TAXONOMY,CI_TAXONOMY,COSTING_TAXONOMY]


RecommentTaxonomies = RecommendTaxonomies
