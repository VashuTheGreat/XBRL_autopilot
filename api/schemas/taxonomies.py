from pydantic import BaseModel
from src.constants import CI_TAXONOMY_VDB

class RecommendTaxonomies(BaseModel):
    keys: list[str]
    collection: str = CI_TAXONOMY_VDB