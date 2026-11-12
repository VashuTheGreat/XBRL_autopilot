from pydantic import BaseModel, Field
from src.constants import IND_AS_TAXONOMY_VDB


class RecommendTaxonomies(BaseModel):
    keys: list[str] = Field(default_factory=list)
    collection: str = IND_AS_TAXONOMY_VDB
    top_k: int = 3
