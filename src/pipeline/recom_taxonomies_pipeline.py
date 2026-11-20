
from typing import Any, List, Literal, Optional
from langchain_core.documents import Document

from src.constants import IND_AS_TAXONOMY_VDB, HYBRID_SEARCH_K
from src.core.logger import logger
from src.services.retrieval.hybrid import get_hybrid_search_service
from src.services.retrieval.reranker import get_reranker_service
from src.utils.main_utils import restore_metadata
from .base import Pipeline



async def RecommendTaxonomies(
    keys: list[str],
    collection= IND_AS_TAXONOMY_VDB,
    top_k: int = 1,
    filter:Optional[dict]=None
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

            candidates = await hybrid_svc.asearch(
                query=key,
                collection=collection,
                k=max(HYBRID_SEARCH_K, top_k),
                filter=filter,
            )
            if not candidates:
                results.append(None)
                continue

            ranked = reranker.rerank(query=key, candidates=candidates, top_k=top_k)
            if ranked:
                matches = ranked[:top_k] if top_k > 1 else [ranked[0]]
                for r in matches:
                    doc = r.document
                    doc.metadata = restore_metadata(getattr(doc, "metadata", {}) or {})
                    doc.metadata.pop("score", None)
                    doc.metadata["relevance_score"] = float(round(r.score, 4))
                    for mk, mv in list(doc.metadata.items()):
                        if hasattr(mv, "item"):
                            doc.metadata[mk] = mv.item()
                    results.append(doc)
            else:
                results.append(None)

        logger.info("pipeline.recommend_taxonomies.completed", results_count=len(results))
        return results



class RecommendationPipeline(Pipeline):
    def __init__(self):
        pass

    async def initiate(
        self,
        keys: list[str],
        collection = IND_AS_TAXONOMY_VDB,
        top_k: int = 3,
        filter:Optional[dict]=None
    ) -> list[dict[str, Any]]:
        return await RecommendTaxonomies(keys=keys, collection=collection, top_k=top_k,filter=filter)
