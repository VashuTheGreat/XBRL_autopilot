import asyncio
import sys
import uuid
from functools import lru_cache
from typing import Any, List, Optional, Union

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from src.app_config import get_app_config
from src.core.exception import MyException
from src.core.logger import logger
from src.services.embeddings.base import BaseEmbedding
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.base import BaseVectorDB


class _QdrantLangchainRetriever(BaseRetriever):
    """LangChain retriever wrapper around QdrantVectorStore for EnsembleRetriever compatibility."""
    vector_store: Any
    k: int = 10

    def _get_relevant_documents(
        self, query: str, *, run_manager: Optional[CallbackManagerForRetrieverRun] = None
    ) -> List[Document]:
        return asyncio.run(self.vector_store.similarity_search(query=query, k=self.k))

    async def _aget_relevant_documents(
        self, query: str, *, run_manager: Optional[Any] = None
    ) -> List[Document]:
        return await self.vector_store.similarity_search(query=query, k=self.k)


class QdrantVectorStore(BaseVectorDB):
    def __init__(
        self,
        collection_name: Optional[str] = None,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        embedding_service: Optional[BaseEmbedding] = None,
        **kwargs,
    ):
        super().__init__()
        self.app_config = get_app_config()
        self.collection_name = collection_name or self.app_config.collection_name
        self.url = url or self.app_config.qdrant_cluster_endpoint
        self.api_key = api_key or self.app_config.qdrant_api_key
        self.embedder = embedding_service or HuggingFaceEmbedding()
        self._async_client: Optional[AsyncQdrantClient] = None
        self._sync_client: Optional[QdrantClient] = None

    def get_async_client(self) -> AsyncQdrantClient:
        if self._async_client is None:
            self._async_client = AsyncQdrantClient(
                url=self.url,
                api_key=self.api_key,
                timeout=60,
            )
        return self._async_client

    def get_sync_client(self) -> QdrantClient:
        if self._sync_client is None:
            self._sync_client = QdrantClient(
                url=self.url,
                api_key=self.api_key,
                timeout=60,
            )
        return self._sync_client

    def _get_vector_dimension(self) -> int:
        if hasattr(self.embedder, "dim"):
            return self.embedder.dim
        if getattr(self.app_config, "embedding_dim", None):
            return int(self.app_config.embedding_dim)
        return 768

    async def ensure_collection(self, collection_name: Optional[str] = None, dim: Optional[int] = None) -> None:
        """Create collection if it does not already exist."""
        col = collection_name or self.collection_name
        with logger.span("qdrant.ensure_collection", collection=col):
            try:
                client = self.get_async_client()
                exists = await client.collection_exists(collection_name=col)
                if not exists:
                    dimension = dim or self._get_vector_dimension()
                    await client.create_collection(
                        collection_name=col,
                        vectors_config=VectorParams(size=dimension, distance=Distance.COSINE),
                    )
                    logger.info("qdrant.collection_created", collection=col, dim=dimension)
                else:
                    logger.debug("qdrant.collection_exists", collection=col)
            except Exception as e:
                logger.error("qdrant.collection_ensure_failed", collection=col, error=str(e))
                raise MyException(sys.exc_info()[1], sys)

    async def recreate_collection(self, collection_name: Optional[str] = None, dim: Optional[int] = None) -> None:
        """Delete collection if it exists, then create fresh."""
        col = collection_name or self.collection_name
        with logger.span("qdrant.recreate_collection", collection=col):
            try:
                client = self.get_async_client()
                exists = await client.collection_exists(collection_name=col)
                if exists:
                    logger.info("qdrant.deleting_existing_collection", collection=col)
                    await client.delete_collection(collection_name=col)
                dimension = dim or self._get_vector_dimension()
                await client.create_collection(
                    collection_name=col,
                    vectors_config=VectorParams(size=dimension, distance=Distance.COSINE),
                )
                logger.info("qdrant.collection_recreated", collection=col, dim=dimension)
            except Exception as e:
                logger.error("qdrant.recreate_collection_failed", collection=col, error=str(e))
                raise MyException(sys.exc_info()[1], sys)

    async def delete_collection(self, collection_name: Optional[str] = None) -> bool:
        """Delete collection if it exists."""
        col = collection_name or self.collection_name
        with logger.span("qdrant.delete_collection", collection=col):
            try:
                client = self.get_async_client()
                exists = await client.collection_exists(collection_name=col)
                if exists:
                    await client.delete_collection(collection_name=col)
                    logger.info("qdrant.collection_deleted", collection=col)
                    return True
                return False
            except Exception as e:
                logger.error("qdrant.delete_collection_failed", collection=col, error=str(e))
                raise MyException(sys.exc_info()[1], sys)

    def add(self, documents: List[Document], **kwargs) -> List[str]:
        return asyncio.run(self.aadd(documents=documents, **kwargs))

    async def aadd(self, documents: Union[Document, List[Document]], **kwargs) -> List[str]:
        if isinstance(documents, Document):
            documents = [documents]

        if not documents:
            logger.debug("qdrant.empty_upsert", collection=self.collection_name)
            return []

        with logger.span("qdrant.upsert", collection=self.collection_name, count=len(documents)):
            try:
                logger.info("qdrant.upsert_started", collection=self.collection_name, count=len(documents))
                await self.ensure_collection()

                texts = [
                    doc.page_content.decode("utf-8") if isinstance(doc.page_content, bytes) else str(doc.page_content)
                    for doc in documents
                ]

                if hasattr(self.embedder, "aembed"):
                    embeddings = await self.embedder.aembed(texts)
                elif hasattr(self.embedder, "embed_documents"):
                    embeddings = self.embedder.embed_documents(texts)
                else:
                    embeddings = self.embedder.embed(texts)

                point_ids = []
                points = []
                for doc, emb in zip(documents, embeddings):
                    pid = str(uuid.uuid4())
                    point_ids.append(pid)
                    metadata = doc.metadata.copy() if getattr(doc, "metadata", None) else {}
                    content = (
                        doc.page_content.decode("utf-8")
                        if isinstance(doc.page_content, bytes)
                        else str(doc.page_content)
                    )
                    payload = {
                        "page_content": content,
                        **metadata,
                    }
                    points.append(
                        PointStruct(
                            id=pid,
                            vector=emb,
                            payload=payload,
                        )
                    )

                client = self.get_async_client()
                await client.upsert(
                    collection_name=self.collection_name,
                    points=points,
                )
                logger.info("qdrant.upsert_completed", collection=self.collection_name, count=len(points))
                return point_ids
            except Exception as e:
                logger.error("qdrant.upsert_failed", collection=self.collection_name, count=len(documents), error=str(e))
                raise MyException(sys.exc_info()[1], sys)

    async def similarity_search(self, query: str, k: int = 4, **kwargs) -> List[Document]:
        with logger.span("qdrant.similarity_search", collection=self.collection_name, k=k):
            try:
                logger.info("qdrant.search_started", collection=self.collection_name, query_preview=query[:50], k=k)
                client = self.get_async_client()
                if hasattr(self.embedder, "aembed"):
                    query_vector = await self.embedder.aembed(query)
                elif hasattr(self.embedder, "embed_query"):
                    query_vector = self.embedder.embed_query(query)
                else:
                    query_vector = self.embedder.embed(query)

                search_response = await client.query_points(
                    collection_name=self.collection_name,
                    query=query_vector,
                    limit=k,
                    with_payload=True,
                )

                documents = []
                for point in search_response.points:
                    payload = (point.payload or {}).copy()
                    content = payload.pop("page_content", "")
                    documents.append(Document(page_content=content, metadata=payload))

                logger.info("qdrant.search_completed", collection=self.collection_name, results_count=len(documents))
                return documents
            except Exception as e:
                logger.error("qdrant.search_failed", collection=self.collection_name, k=k, error=str(e))
                raise MyException(sys.exc_info()[1], sys)

    def search(self, query: str, k: int = 4) -> List[Document]:
        return asyncio.run(self.similarity_search(query=query, k=k))

    async def asearch(self, query: str, k: int = 4) -> List[Document]:
        return await self.similarity_search(query=query, k=k)

    def as_retriever(self, search_kwargs: Optional[dict] = None) -> BaseRetriever:
        kwargs = search_kwargs or {}
        k = kwargs.get("k", 10)
        return _QdrantLangchainRetriever(vector_store=self, k=k)


_qdrant_instances: dict[str, QdrantVectorStore] = {}


def get_qdrant_service(
    collection_name: Optional[str] = None,
    embedding_service: Optional[BaseEmbedding] = None,
) -> QdrantVectorStore:
    cfg = get_app_config()
    target_name = collection_name or cfg.collection_name
    if target_name not in _qdrant_instances:
        _qdrant_instances[target_name] = QdrantVectorStore(
            collection_name=target_name,
            embedding_service=embedding_service,
        )
    return _qdrant_instances[target_name]
