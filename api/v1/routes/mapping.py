"""Auto-tagging suggestions (docs/06-ai-auto-tagging.md). Stateless: the app sends the workbook, periods and its
mapping memory; the route returns suggestions only. Nothing is tagged here."""
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from api.responses import error_response, success_response
from api.v1.schemas.mapping import SuggestRequest
from src.app_config import get_app_config
from src.core.logger import logger
from src.services.tagging.candidates import MemoryItem
from src.services.tagging.catalog import catalog_for
from src.services.tagging.rerank import GroqReranker
from src.services.tagging.suggest import SuggestOptions, suggest

router = APIRouter()


@router.post("/suggest")
async def suggest_mappings(body: SuggestRequest):
    try:
        catalog = await run_in_threadpool(catalog_for, body.taxonomy)
    except LookupError as exc:
        return error_response(str(exc), status_code=404)
    cfg = get_app_config()
    reranker = GroqReranker(cfg.groq_api_key, cfg.groq_model) if body.options.useLlm and cfg.groq_api_key else None
    sheets = [{"name": s.name, "cells": [c.model_dump() for c in s.cells]} for s in body.sheets]
    memory = [MemoryItem(m.label, m.concept, m.approvals) for m in body.memory]
    with logger.span("mapping.suggest", sheets=len(sheets), memory=len(memory), llm=reranker is not None):
        result = await run_in_threadpool(
            suggest, catalog, sheets, body.periods.cyEnd, body.periods.pyEnd, memory,
            SuggestOptions(max_candidates=body.options.maxCandidates, use_llm=reranker is not None), reranker,
        )
    data = result.to_json()
    data["level"] = body.level
    return success_response(data, message=f"{len(result.suggestions)} suggestions")
