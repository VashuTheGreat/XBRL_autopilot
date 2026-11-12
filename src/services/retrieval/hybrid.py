"""Hybrid Retrieval Service: combines Chroma Vector Search and LangChain BM25 with LangChain EnsembleRetriever."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from langchain_classic.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document

from src.constants import (
    CI_OUTPUT_JSON,
    CI_TAXONOMY_VDB,
    COST_OUTPUT_JSON,
    COSTING_TAXONOMY_VDB,
    INDAS_OUTPUT_JSON,
    IND_AS_TAXONOMY_VDB,
)
from src.core.logger import logger
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.chroma import ChromaVectorDB

TaxonomyCollection = Literal["ind_as_taxonomy", "ci_taxonomy", "costing_taxonomy"]

TAXONOMY_JSON_PATHS = {
    IND_AS_TAXONOMY_VDB: INDAS_OUTPUT_JSON,
    CI_TAXONOMY_VDB: CI_OUTPUT_JSON,
    COSTING_TAXONOMY_VDB: COST_OUTPUT_JSON,
}


@dataclass
class HybridCandidate:
    """A search candidate item returned by retrieval."""
    document: Document
    qname: str
    label: str
    score: float = 0.0


class HybridSearchService:
    """Beginner-friendly Hybrid Search combining Chroma Vector DB and LangChain BM25 using LangChain EnsembleRetriever."""

    def __init__(self, embedding_model=None, vector_db: ChromaVectorDB | None = None):
        self._embedding = embedding_model
        self._vector_db = vector_db
        self._bm25_retrievers: dict[str, BM25Retriever] = {}

    def get_vector_db(self) -> ChromaVectorDB:
        if self._vector_db is None:
            if self._embedding is None:
                self._embedding = HuggingFaceEmbedding()
            self._vector_db = ChromaVectorDB(embedding_function=self._embedding.embedding_model)
        return self._vector_db

    def get_bm25_retriever(self, collection: str) -> BM25Retriever:
        """Loads concepts from knowledge base JSON and initializes LangChain BM25Retriever."""
        if collection in self._bm25_retrievers:
            return self._bm25_retrievers[collection]

        json_path = TAXONOMY_JSON_PATHS.get(collection)
        if not json_path or not Path(json_path).exists():
            logger.warning("hybrid.taxonomy_json_missing", collection=collection, path=str(json_path))
            retriever = BM25Retriever.from_documents([])
            self._bm25_retrievers[collection] = retriever
            return retriever

        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        concepts: dict[str, dict] = data.get("concepts", {})
        docs: list[Document] = []
        for qname, c in concepts.items():
            # Exclude abstract elements, members, axes, tables (not reportable cell facts)
            if c.get("abstract") in (True, "true") or qname.endswith("Member") or qname.endswith("Axis") or qname.endswith("Table") or qname.endswith("Abstract"):
                continue

            label = (c.get("labels", {}) or {}).get("label", "") or ""
            name = c.get("name", "") or ""
            docs.append(Document(
                page_content=f"{label} | {qname} | {name}",
                metadata={"qname": qname, "label": label, **c},
            ))

        retriever = BM25Retriever.from_documents(docs)
        self._bm25_retrievers[collection] = retriever
        logger.info("hybrid.bm25_retriever_initialized", collection=collection, count=len(docs))
        return retriever

    def get_ensemble_retriever(self, collection: str, k: int = 10) -> EnsembleRetriever:
        """Builds a LangChain EnsembleRetriever combining Chroma vector search and BM25 with 50/50 weights."""
        bm25 = self.get_bm25_retriever(collection)
        bm25.k = k

        db = self.get_vector_db()
        store = getattr(db, {
            IND_AS_TAXONOMY_VDB: "vector_store_ind",
            CI_TAXONOMY_VDB: "vector_store_ci",
            COSTING_TAXONOMY_VDB: "vector_store_cost",
        }.get(collection, "vector_store_ind"))

        vector_retriever = store.as_retriever(search_kwargs={"k": k})

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
        """Runs LangChain EnsembleRetriever over Vector DB + BM25 and returns LangChain Documents."""
        clean_query = query.strip()
        if not clean_query:
            return []

        with logger.span("hybrid.asearch", query=clean_query, collection=collection, k=k):
            ensemble = self.get_ensemble_retriever(collection, k=k)
            docs = await ensemble.ainvoke(clean_query)
            reportable = [
                d for d in docs
                if d.metadata.get("abstract") not in (True, "true")
                and not d.metadata.get("qname", "").endswith("Member")
                and not d.metadata.get("qname", "").endswith("Axis")
                and not d.metadata.get("qname", "").endswith("Table")
                and not d.metadata.get("qname", "").endswith("Abstract")
            ]
            return reportable[:k]


_default_hybrid: HybridSearchService | None = None


def get_hybrid_search_service() -> HybridSearchService:
    global _default_hybrid
    if _default_hybrid is None:
        _default_hybrid = HybridSearchService()
    return _default_hybrid
