"""Hybrid Retrieval Service: combines Qdrant Vector Search and BM25 with LangChain EnsembleRetriever."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Optional

from langchain_classic.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document

from src.constants import (
    CI_OUTPUT_JSON,
    CI_TAXONOMY_VDB,
    COST_OUTPUT_JSON,
    COST_TAXONOMY_VDB,
    COSTING_TAXONOMY_VDB,
    INDAS_OUTPUT_JSON,
    IND_AS_TAXONOMY_VDB,
)
from src.core.logger import logger
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.qdrant import QdrantVectorStore, get_qdrant_service

TaxonomyCollection = Literal["ind_as_taxonomy", "ci_taxonomy", "cost_taxonomy", "costing_taxonomy"]

TAXONOMY_JSON_PATHS = {
    IND_AS_TAXONOMY_VDB: INDAS_OUTPUT_JSON,
    CI_TAXONOMY_VDB: CI_OUTPUT_JSON,
    COST_TAXONOMY_VDB: COST_OUTPUT_JSON,
    COSTING_TAXONOMY_VDB: COST_OUTPUT_JSON,
}


def normalize_collection_name(collection: str) -> str:
    """Normalize input collection name to the canonical Qdrant collection name."""
    col = (collection or "").strip().lower()
    if col in {"costing_taxonomy", "cost_taxonomy", "cost"}:
        return COST_TAXONOMY_VDB
    if col in {"ci_taxonomy", "ci"}:
        return CI_TAXONOMY_VDB
    return IND_AS_TAXONOMY_VDB


@dataclass
class HybridCandidate:
    """A search candidate item returned by retrieval."""
    document: Document
    qname: str
    label: str
    score: float = 0.0


class HybridSearchService:
    """Hybrid Search combining Qdrant Vector Store and LangChain BM25 using EnsembleRetriever."""

    def __init__(self, embedding_model=None, vector_db: Optional[Any] = None):
        self._embedding = embedding_model
        self._vector_db = vector_db
        self._bm25_retrievers: dict[str, BM25Retriever] = {}

    def _get_embedding(self) -> HuggingFaceEmbedding:
        if self._embedding is None:
            self._embedding = HuggingFaceEmbedding()
        return self._embedding

    def _get_vector_store(self, collection: str) -> QdrantVectorStore:
        canon = normalize_collection_name(collection)
        return get_qdrant_service(collection_name=canon, embedding_service=self._get_embedding())

    def _get_bm25_retriever(self, collection: str) -> BM25Retriever:
        """Load concepts from knowledge base JSON and initialize LangChain BM25Retriever."""
        canon = normalize_collection_name(collection)
        if canon in self._bm25_retrievers:
            return self._bm25_retrievers[canon]

        json_path = TAXONOMY_JSON_PATHS.get(canon)
        if not json_path or not Path(json_path).exists():
            logger.warning("hybrid.taxonomy_json_missing", collection=canon, path=str(json_path))
            retriever = BM25Retriever.from_documents([])
            self._bm25_retrievers[canon] = retriever
            return retriever

        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        concepts: dict[str, dict] = data.get("concepts", {})
        docs: list[Document] = []
        for qname, c in concepts.items():
            # Exclude abstract elements, members, axes, tables (not reportable cell facts)
            if (
                c.get("abstract") in (True, "true")
                or qname.endswith("Member")
                or qname.endswith("Axis")
                or qname.endswith("Table")
                or qname.endswith("Abstract")
            ):
                continue

            label = (c.get("labels", {}) or {}).get("label", "") or ""
            name = c.get("name", "") or ""
            docs.append(
                Document(
                    page_content=f"{label} | {qname} | {name}",
                    metadata={"qname": qname, "label": label, **c},
                )
            )

        retriever = BM25Retriever.from_documents(docs)
        self._bm25_retrievers[canon] = retriever
        logger.info("hybrid.bm25_retriever_initialized", collection=canon, count=len(docs))
        return retriever

    def _get_ensemble_retriever(self, collection: str, k: int = 10) -> EnsembleRetriever:
        """Build a LangChain EnsembleRetriever combining Qdrant vector search and BM25."""
        canon = normalize_collection_name(collection)
        bm25 = self._get_bm25_retriever(canon)
        bm25.k = k

        vector_store = self._get_vector_store(canon)
        vector_retriever = vector_store.as_retriever(search_kwargs={"k": k})

        ensemble = EnsembleRetriever(
            retrievers=[vector_retriever, bm25],
            weights=[0.5, 0.5],
        )
        return ensemble

    async def asearch(
        self,
        query: str,
        collection: TaxonomyCollection = IND_AS_TAXONOMY_VDB,
        k: int = 10,
    ) -> list[Document]:
        """Run EnsembleRetriever over Qdrant Vector DB + BM25 and return reportable Documents."""
        clean_query = query.strip()
        if not clean_query:
            return []

        canon = normalize_collection_name(collection)
        with logger.span("hybrid.asearch", query=clean_query, collection=canon, k=k):
            try:
                ensemble = self._get_ensemble_retriever(canon, k=k)
                docs = await ensemble.ainvoke(clean_query)
            except Exception as e:
                logger.warning("hybrid.ensemble_fallback_to_bm25", error=str(e), collection=canon)
                bm25 = self._get_bm25_retriever(canon)
                docs = await bm25.ainvoke(clean_query)

            reportable = [
                d
                for d in docs
                if d.metadata.get("abstract") not in (True, "true")
                and not d.metadata.get("qname", "").endswith("Member")
                and not d.metadata.get("qname", "").endswith("Axis")
                and not d.metadata.get("qname", "").endswith("Table")
                and not d.metadata.get("qname", "").endswith("Abstract")
            ]
            logger.info("hybrid.asearch_completed", collection=canon, count=len(reportable[:k]))
            return reportable[:k]


_default_hybrid: Optional[HybridSearchService] = None


def get_hybrid_search_service() -> HybridSearchService:
    global _default_hybrid
    if _default_hybrid is None:
        _default_hybrid = HybridSearchService()
    return _default_hybrid
