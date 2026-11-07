from __future__ import annotations
import re
from typing import Annotated, Any, Dict, List, Optional
from fastapi import APIRouter, Query

from src.core.logger import logger
from src.services.spreadsheet_service import (
    get_live_financial_differences,
    map_row_tag,
    remove_row_tag,
    update_sheet_settings,
)
from src.services.taxonomy_catalog import get_taxonomy_tree, search_concepts_catalog
from src.web.responses import error_response, success_response
from src.web.schemas.taxonomies import (
    ADDTaxonomies,
    BatchApplyTagsRequest,
    RecommendTaxonomies,
    SheetSettingsRequest,
    TagRowDeleteRequest,
    TagRowRequest,
)
from src.web.state import get_session

router = APIRouter()


def _format_recommendations(keys: List[str], documents: List[Any]) -> List[Dict[str, Any]]:
    results = []
    for i, key in enumerate(keys):
        doc = documents[i] if i < len(documents) else None
        if not doc:
            results.append({
                "input": key,
                "concept": None,
                "label": None,
                "confidence": 0.0,
                "document": None,
            })
            continue

        raw = getattr(doc, "page_content", str(doc))
        parts = [p.strip() for p in raw.split("|")]
        label = parts[0] if parts else raw
        concept = parts[1] if len(parts) > 1 else None
        name = parts[2] if len(parts) > 2 else None

        results.append({
            "input": key,
            "concept": concept or name or label,
            "label": label,
            "name": name,
            "confidence": 0.95,
            "document": doc,
        })
    return results


@router.post("")
async def add_taxonomies(payload: ADDTaxonomies):
    with logger.span("taxonomies.add", count=len(payload.taxonomies)):
        try:
            from src.ingestion.store_taxonomies import StoreTaxonomies
            res = await StoreTaxonomies(taxonomies=payload.taxonomies, collection=payload.collections)
            logger.info("taxonomies.stored", count=len(payload.taxonomies))
            return success_response(data=res, message="Taxonomies stored successfully")
        except Exception:
            logger.exception("taxonomies.store_failed")
            return error_response(message="Failed to store taxonomies", status_code=400)


@router.get("")
async def recommend_taxonomies(payload: Annotated[RecommendTaxonomies, Query()]):
    with logger.span("taxonomies.recommend", keys_count=len(payload.keys)):
        try:
            from src.pipeline.recom_taxonomies import RecommendTaxonomies as RunRecommend
            raw_docs = await RunRecommend(keys=payload.keys, collection=payload.collection)
            formatted = _format_recommendations(payload.keys, raw_docs or [])
            return success_response(
                data=formatted,
                message="Taxonomies recommended successfully",
            )
        except Exception:
            logger.exception("taxonomies.recommend_failed")
            return success_response(data=[], message="Taxonomies recommendation unavailable")


@router.post("/recommend")
async def recommend_taxonomies_post(payload: RecommendTaxonomies):
    with logger.span("taxonomies.recommend_post", keys_count=len(payload.keys)):
        try:
            from src.pipeline.recom_taxonomies import RecommendTaxonomies as RunRecommend
            raw_docs = await RunRecommend(keys=payload.keys, collection=payload.collection)
            formatted = _format_recommendations(payload.keys, raw_docs or [])
            return success_response(
                data=formatted,
                message="Taxonomies recommended successfully",
            )
        except Exception:
            logger.exception("taxonomies.recommend_post_failed")
            return success_response(data=[], message="Taxonomies recommendation unavailable")


@router.get("/tree")
def get_tree(
    elr_uri: str | None = Query(None),
    q: str | None = Query(None),
    session_id: str = "default",
):
    with logger.span("taxonomies.get_tree", elr_uri=elr_uri, q=q, session_id=session_id):
        s = get_session(session_id)
        data = get_taxonomy_tree(s, elr_uri=elr_uri, filter_query=q)
        return success_response(data=data, message="Taxonomy tree retrieved successfully")


@router.get("/search")
def search_catalog(
    q: str = Query(..., min_length=1),
    limit: int = Query(50, ge=1, le=200),
    session_id: str = "default",
):
    with logger.span("taxonomies.search_catalog", q=q, session_id=session_id):
        s = get_session(session_id)
        data = search_concepts_catalog(s.A, query=q, limit=limit)
        return success_response(data=data, message="Concepts found successfully")


@router.post("/tag-row")
def tag_sheet_row(payload: TagRowRequest, session_id: str = "default"):
    with logger.span("taxonomies.tag_row", sheet=payload.sheet, row=payload.rowIndex, concept=payload.concept):
        s = get_session(session_id)
        res = map_row_tag(
            session_id=session_id,
            filing_session=s,
            sheet_name=payload.sheet,
            row_index=payload.rowIndex,
            concept=payload.concept,
            label=payload.label,
            cy_col=payload.cyCol,
            py_col=payload.pyCol,
            note_col=payload.noteCol,
            rounding=payload.rounding,
        )
        diffs = get_live_financial_differences(s)
        return success_response(
            data={"mapping": res, "differences": diffs, "revision": s.filing.revision},
            message="Row tagged successfully",
        )


@router.post("/untag-row")
def untag_sheet_row(payload: TagRowDeleteRequest, session_id: str = "default"):
    with logger.span("taxonomies.untag_row", sheet=payload.sheet, row=payload.rowIndex):
        s = get_session(session_id)
        removed = remove_row_tag(
            session_id=session_id,
            filing_session=s,
            sheet_name=payload.sheet,
            row_index=payload.rowIndex,
        )
        diffs = get_live_financial_differences(s)
        return success_response(
            data={"removed": removed, "differences": diffs, "revision": s.filing.revision},
            message="Row untagged successfully",
        )


@router.post("/batch-apply")
def batch_apply_tags(payload: BatchApplyTagsRequest, session_id: str = "default"):
    with logger.span("taxonomies.batch_apply", sheet=payload.sheet, count=len(payload.mappings)):
        s = get_session(session_id)
        applied_count = 0
        errors = []

        for m in payload.mappings:
            row_idx = m.get("rowIndex")
            concept = m.get("concept")
            label = m.get("label", "")
            if not row_idx or not concept:
                continue

            try:
                map_row_tag(
                    session_id=session_id,
                    filing_session=s,
                    sheet_name=payload.sheet,
                    row_index=row_idx,
                    concept=concept,
                    label=label,
                    cy_col=payload.cyCol,
                    py_col=payload.pyCol,
                    note_col=payload.noteCol,
                    rounding=payload.rounding,
                )
                applied_count += 1
            except Exception as e:
                errors.append(f"Row {row_idx}: {e}")

        diffs = get_live_financial_differences(s)
        return success_response(
            data={
                "appliedCount": applied_count,
                "errors": errors,
                "differences": diffs,
                "revision": s.filing.revision,
            },
            message=f"Applied {applied_count} taxonomy tags successfully",
        )


@router.get("/differences")
def get_differences(session_id: str = "default"):
    with logger.span("taxonomies.get_differences", session_id=session_id):
        s = get_session(session_id)
        data = get_live_financial_differences(s)
        return success_response(data=data, message="Financial differences calculated successfully")


@router.post("/settings")
def save_settings(payload: SheetSettingsRequest, session_id: str = "default"):
    with logger.span("taxonomies.save_settings", sheet=payload.sheet, gap=payload.colDiff):
        try:
            res = update_sheet_settings(
                session_id=session_id,
                sheet_name=payload.sheet,
                particulars_col=payload.particularsCol,
                cy_col=payload.cyCol,
                col_diff=payload.colDiff,
                rounding=payload.rounding,
            )
            return success_response(data=res, message="Sheet settings updated successfully")
        except Exception as e:
            logger.exception("taxonomies.save_settings_failed")
            return error_response(message=f"Failed to update settings: {e}", status_code=400)

