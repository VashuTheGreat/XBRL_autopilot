from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass
from typing import Any, List, Optional

from langchain_community.document_compressors.flashrank_rerank import FlashrankRerank
from langchain_core.documents import Document

from src.core.exception import MyException
from src.core.logger import logger
from src.utils.main_utils import restore_metadata
from src.utils.text_utils import norm_label


@dataclass
class RankedDocument:
    document: Document
    qname: str
    label: str
    score: float
    metadata: dict[str, Any]


class RerankerService:
    """Fast, accurate neural reranker powered by FlashRank with exact match awareness."""

    def __init__(self, top_k: int = 3, model_name: str = "ms-marco-TinyBERT-L-2-v2"):
        self.top_k = top_k
        self._ranker = FlashrankRerank(model=model_name, top_n=20)

    def rerank(
        self,
        query: str,
        candidates: List[Document],
        top_k: Optional[int] = None,
    ) -> List[RankedDocument]:
        """Reranks candidate documents against query using FlashRank."""
        if not candidates or not query:
            return []

        k = top_k or self.top_k
        self._ranker.top_n = len(candidates)

        with logger.span("reranker.execution", query=query, candidates_count=len(candidates), top_k=k):
            try:
                compressed_docs = self._ranker.compress_documents(candidates, query)
            except Exception as e:
                logger.warning("reranker.fallback", error=str(e))
                compressed_docs = candidates

            results: List[RankedDocument] = []
            q_norm = norm_label(query)
            for doc in compressed_docs:
                raw_meta = getattr(doc, "metadata", {}) or {}
                meta = restore_metadata(raw_meta)
                if isinstance(meta.get("labels"), str):
                    try:
                        meta["labels"] = json.loads(meta["labels"])
                    except Exception:
                        pass

                qname = meta.get("qname") or (
                    doc.page_content.split(" | ")[1] if " | " in doc.page_content else ""
                )
                label = (meta.get("labels") or {}).get("label") or (
                    doc.page_content.split(" | ")[0] if " | " in doc.page_content else ""
                )
                meta["label"] = label
                meta["qname"] = qname

                score = float(meta.get("relevance_score", 0.8))
                score = max(0.0, min(1.0, score))

                # Exact label match gets top score
                if q_norm and q_norm == norm_label(label):
                    score = 1.0

                results.append(
                    RankedDocument(
                        document=doc,
                        qname=qname,
                        label=label,
                        score=score,
                        metadata=meta,
                    )
                )

            results.sort(key=lambda r: r.score, reverse=True)
            logger.info("reranker.completed", query=query, ranked_count=len(results), top_k=k)
            return results[:k]


_default_reranker: Optional[RerankerService] = None


def get_reranker_service() -> RerankerService:
    global _default_reranker
    if _default_reranker is None:
        _default_reranker = RerankerService()
    return _default_reranker


_shared_compressor: Optional[FlashrankRerank] = None


def _get_compressor() -> FlashrankRerank:
    global _shared_compressor
    if _shared_compressor is None:
        _shared_compressor = FlashrankRerank(model="ms-marco-TinyBERT-L-2-v2", top_n=5)
    return _shared_compressor


async def flaskreranker(query: str, documents: List[Document]) -> dict[str, Any]:
    """Rerank retrieved documents based on relevance to the query (used by agent retriever)."""
    with logger.span("reranker.flaskreranker", query=query, doc_count=len(documents)):
        try:
            logger.info("reranker.start_reranking", query=query, count=len(documents))
            compressor = _get_compressor()
            reranked_documents = await asyncio.to_thread(
                compressor.compress_documents, query=query, documents=documents
            )
            # Ensure all metadata values (like numpy.float32 relevance_score) are native Python types
            for doc in reranked_documents:
                if hasattr(doc, "metadata") and isinstance(doc.metadata, dict):
                    for k, v in list(doc.metadata.items()):
                        if hasattr(v, "item"):
                            doc.metadata[k] = v.item()
                        elif hasattr(v, "__float__") and not isinstance(v, (int, float, str, bool)):
                            doc.metadata[k] = float(v)
            logger.info("reranker.reranking_complete", count=len(reranked_documents))
            return {"reranked_content": reranked_documents}
        except Exception as e:
            logger.error("reranker.failed", error=str(e))
            raise MyException(e, sys)
