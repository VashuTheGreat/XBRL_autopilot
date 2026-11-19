import asyncio
import concurrent.futures
import uuid
from pathlib import Path
from typing import Optional

from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document

from src.constants import BM25_DIR_PATH, IND_AS_TAXONOMY_VDB
from src.utils.main_utils import load_object, save_object

from .base import BaseVectorDB

_bm25_instances: dict[str, "BM25"] = {}


def _run_sync(coro):
    """Run an async util safely from synchronous code."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class BM25(BaseVectorDB):
    """LangChain BM25Retriever wrapper persisted via save_object / load_object."""

    def __init__(self, pickle_path: str | Path = BM25_DIR_PATH):
        self.pickle_path = Path(pickle_path)
        self.documents: list[Document] = []
        self.retriever: Optional[BM25Retriever] = None

    def _build_retriever(self, k: int = 4) -> None:
        if self.documents:
            self.retriever = BM25Retriever.from_documents(self.documents, k=k)
        else:
            self.retriever = None

    def save(self) -> None:
        self.pickle_path.parent.mkdir(parents=True, exist_ok=True)
        _run_sync(save_object(file_path=self.pickle_path, object=self))

    @classmethod
    def load(cls, pickle_path: str | Path = BM25_DIR_PATH) -> "BM25":
        target = Path(pickle_path)
        obj: BM25 = _run_sync(load_object(file_path=target))
        obj.pickle_path = target
        if obj.documents and obj.retriever is None:
            obj._build_retriever()
        return obj

    def add(self, documents: list[Document]) -> list[str]:
        if not documents:
            return []

        ids: list[str] = []
        for doc in documents:
            doc_id = doc.id or str(uuid.uuid4())
            self.documents.append(
                Document(id=doc_id, page_content=doc.page_content, metadata=doc.metadata or {})
            )
            ids.append(doc_id)

        self._build_retriever()
        self.save()
        return ids

    async def aadd(self, documents: list[Document]) -> list[str]:
        if not documents:
            return []

        return self.add(documents)

    def as_retriever(self, k: int = 4) -> BM25Retriever:
        if self.retriever is None:
            self._build_retriever(k=k)
        else:
            self.retriever.k = k

        if self.retriever is None:
            return BM25Retriever.from_documents([])
        return self.retriever

    def search(self, query: str, k: int = 4) -> list[Document]:
        if k <= 0 or not self.documents:
            return []

        if self.retriever is None:
            self._build_retriever(k=k)
        else:
            self.retriever.k = k

        return self.retriever.invoke(query)

    async def asearch(self, query: str, k: int = 4) -> list[Document]:
        if k <= 0 or not self.documents:
            return []

        if self.retriever is None:
            self._build_retriever(k=k)
        else:
            self.retriever.k = k

        return await self.retriever.ainvoke(query)


def get_bm25_service(collection_name: str = IND_AS_TAXONOMY_VDB) -> BM25:
    global _bm25_instances
    if collection_name not in _bm25_instances:
        base_dir = Path(BM25_DIR_PATH)
        path = base_dir / f"{collection_name}.pkl"
        _bm25_instances[collection_name] = BM25.load(path) if path.exists() else BM25(path)
    return _bm25_instances[collection_name]