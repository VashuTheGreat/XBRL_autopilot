from fastapi import APIRouter, Query
from src.core.logger import logger
from typing import Annotated
from api.schemas.taxonomies import RecommendTaxonomies as RecommendTaxonomiesSchema
from src.pipeline.recom_taxonomies import RecommendTaxonomies
from api.responses import *
router = APIRouter()


@router.get("")
async def recommend_taxonomies(payload: Annotated[RecommendTaxonomiesSchema, Query()]):
    with logger.span("taxonomies.recommend", keys_count=len(payload.keys)):
        try:
            target_coll = payload.collection
            raw_docs = await RecommendTaxonomies(keys=payload.keys, collection=target_coll)
            return success_response(
                data=raw_docs,
                message="Taxonomies recommended successfully",
            )
        except Exception:
            logger.exception("taxonomies.recommend_failed")
            return success_response(data=[], message="Taxonomies recommendation unavailable")
