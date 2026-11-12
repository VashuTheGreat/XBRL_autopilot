"""Taxonomy recommendation pipeline powered by Hybrid Retrieval and Reranking."""
from __future__ import annotations

from typing import Any, Literal
from langchain_core.documents import Document

from src.constants import CI_TAXONOMY_VDB, COSTING_TAXONOMY_VDB, IND_AS_TAXONOMY_VDB
from src.core.logger import logger
from src.services.retrieval.hybrid import get_hybrid_search_service
from src.services.retrieval.reranking import get_reranker_service
from src.utils.main_utils import restore_metadata

TaxonomyCollection = Literal["ind_as_taxonomy", "ci_taxonomy", "costing_taxonomy"]


async def RecommendTaxonomies(
    keys: list[str],
    collection: TaxonomyCollection = IND_AS_TAXONOMY_VDB,
    top_k: int = 1,
) -> list[Document | dict[str, Any] | None]:
    """Recommends taxonomy concepts for a list of line item keys using Hybrid Search + Reranker.
    
    Empty keys are stripped and skipped.
    Each returned document has restored metadata and an added 'score' field.
    """
    clean_keys = [k.strip() if isinstance(k, str) else "" for k in keys]
    with logger.span("pipeline.recommend_taxonomies", total_keys=len(keys), clean_keys=len([k for k in clean_keys if k])):
        hybrid_svc = get_hybrid_search_service()
        reranker = get_reranker_service()
        results: list[Document | None] = []

        for key in clean_keys:
            if not key:
                results.append(None)
                continue

            candidates = await hybrid_svc.asearch(query=key, collection=collection, k=10)
            if not candidates:
                results.append(None)
                continue

            ranked = reranker.rerank(query=key, candidates=candidates, top_k=top_k)
            if ranked:
                best = ranked[0]
                doc = best.document
                doc.metadata = restore_metadata(getattr(doc, "metadata", {}) or {})
                doc.metadata["score"] = round(best.score, 3)
                doc.metadata["qname"] = best.qname
                doc.metadata["label"] = best.label
                results.append(doc)
            else:
                results.append(None)

        logger.info("pipeline.recommend_taxonomies.completed", results_count=len(results))
        return results


async def RecommendTaxonomiesWithScores(
    keys: list[str],
    collection: TaxonomyCollection = IND_AS_TAXONOMY_VDB,
    top_k: int = 3,
) -> list[dict[str, Any]]:
    """Detailed recommendation endpoint for the UI returning structured objects with scores."""
    clean_keys = [k.strip() if isinstance(k, str) else "" for k in keys]
    with logger.span("pipeline.recommend_taxonomies_with_scores", count=len(keys)):
        hybrid_svc = get_hybrid_search_service()
        reranker = get_reranker_service()
        results: list[dict[str, Any]] = []

        for key in clean_keys:
            if not key:
                continue

            candidates = await hybrid_svc.asearch(query=key, collection=collection, k=10)
            ranked = reranker.rerank(query=key, candidates=candidates, top_k=top_k)
            
            item_recs = []
            for r in ranked:
                meta = restore_metadata(r.metadata)
                item_recs.append({
                    "qname": r.qname,
                    "label": r.label,
                    "score": round(r.score, 3),
                    "confidencePercent": int(round(r.score * 100)),
                    "periodType": meta.get("periodType"),
                    "balance": meta.get("balance"),
                    "type": meta.get("type"),
                })

            results.append({
                "key": key,
                "matches": item_recs,
                "bestMatch": item_recs[0] if item_recs else None,
            })

        return results
