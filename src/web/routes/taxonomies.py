from __future__ import annotations
from typing import List, Annotated
from fastapi import APIRouter, Query

from src.core.logger import logger
from src.web.responses import error_response, success_response
from src.web.schemas.taxonomies import ADDTaxonomies, RecommendTaxonomies

router = APIRouter()


@router.post("")
async def add_taxonomies(payload: ADDTaxonomies):
    with logger.span("taxonomies.add", count=len(payload.taxonomies)):
        try:
            from src.ingestion.store_taxonomies import StoreTaxonomies
            res = await StoreTaxonomies(taxonomies=payload.taxonomies,collection=payload.collections)
            logger.info("taxonomies.stored", count=len(payload.taxonomies))
            return success_response(data=res, message="Taxonomies stored successfully")
        except Exception:
            logger.exception("taxonomies.store_failed")
            return error_response(message="Failed to store taxonomies", status_code=400)


@router.get("")
async def recommend_taxonomies(payload: Annotated[RecommendTaxonomies,Query()]):
    with logger.span("taxonomies.recommend", keys_count=len(payload.keys)):
        try:
            from src.pipeline.recom_taxonomies import RecommendTaxonomies
            data = await RecommendTaxonomies(keys=payload.keys,collection=payload.collection)
            return success_response(
                data=data or [],
                message="Taxonomies recommended successfully",
            )
        except Exception:
            logger.exception("taxonomies.recommend_failed")
            return success_response(data=[], message="Taxonomies recommendation unavailable")
