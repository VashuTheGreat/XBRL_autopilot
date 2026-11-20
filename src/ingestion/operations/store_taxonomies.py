from typing import List, Literal
from langchain_core.documents import Document
from src.constants import IND_AS_TAXONOMY_VDB, BM25_DIR_PATH
from src.core.logger import logger
from src.services.retrieval.hybrid import normalize_collection_name
from src.services.vectordb.qdrant import get_qdrant_service
from src.services.vectordb.bm25 import get_bm25_service
from langchain_community.retrievers import BM25Retriever

async def StoreTaxonomies(
    taxonomies: list[Document],
    collection: str = IND_AS_TAXONOMY_VDB,
) -> None:
    """Store taxonomy document batch into the specified Qdrant collection."""
    canon = normalize_collection_name(collection)
    with logger.span("ingestion.store_taxonomies", count=len(taxonomies), collection=canon):
        vector_store = get_qdrant_service(collection_name=canon)
        bm25_retriever = get_bm25_service(collection_name=canon)
        await vector_store.aadd(documents=taxonomies)
        await bm25_retriever.aadd(documents=taxonomies)
        logger.info("ingestion.store_taxonomies.completed", count=len(taxonomies), collection=canon)
