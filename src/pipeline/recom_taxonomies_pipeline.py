"""Taxonomy recommendation pipeline powered by Hybrid Retrieval (Qdrant + BM25) and FlashRank Reranker."""
from __future__ import annotations

from typing import Any, List, Literal, Optional
from langchain_core.documents import Document

from src.constants import CI_TAXONOMY_VDB, COST_TAXONOMY_VDB, IND_AS_TAXONOMY_VDB
from src.core.logger import logger
from src.services.retrieval.hybrid import get_hybrid_search_service
from src.services.retrieval.reranker import get_reranker_service
from src.utils.main_utils import restore_metadata
from .base import Pipeline

TaxonomyCollection = Literal["ind_as_taxonomy", "ci_taxonomy", "cost_taxonomy", "costing_taxonomy"]


async def RecommendTaxonomies(
    keys: list[str],
    collection: TaxonomyCollection = IND_AS_TAXONOMY_VDB,
    top_k: int = 1,
) -> list[Document | None]:
    """Recommend top taxonomy concepts for a list of line item keys using Hybrid Search + Reranker."""
    clean_keys = [k.strip() if isinstance(k, str) else "" for k in keys]
    with logger.span("pipeline.recommend_taxonomies", total_keys=len(keys)):
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

        logger.info("pipeline.recommend_taxonomies_with_scores.completed", count=len(results))
        return results


class RecommendationPipeline(Pipeline):
    def __init__(self):
        pass

    async def initiate(
        self,
        keys: list[str],
        collection: TaxonomyCollection = IND_AS_TAXONOMY_VDB,
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        return await RecommendTaxonomiesWithScores(keys=keys, collection=collection, top_k=top_k)
