from typing import List, Optional, Any
from langchain_core.documents import Document
from .base import BaseVectorDB
from langchain_chroma import Chroma
from constants import COLLECTION_NAME, VECTOR_DB_PATH

class ChromaVectorDB(BaseVectorDB):
    def __init__(self, embedding_function: Optional[Any] = None, **kwargs):
        super().__init__()
        self.vector_store = Chroma(
            collection_name=COLLECTION_NAME,
            persist_directory=VECTOR_DB_PATH,
            embedding_function=embedding_function,
            **kwargs
        )

    def add(self, documents: List[Document]) -> List[str]:
        """Synchronously add documents to the vector database."""
        return self.vector_store.add_documents(documents=documents)

    async def aadd(self, documents: List[Document]) -> List[str]:
        """Asynchronously add documents to the vector database."""
        return await self.vector_store.aadd_documents(documents=documents)

    def search(self, query: str, k: int = 4) -> List[Document]:
        """Synchronously search for similar documents."""
        return self.vector_store.similarity_search(query=query, k=k)

    async def asearch(self, query: str, k: int = 4) -> List[Document]:
        """Asynchronously search for similar documents using langchain's asimilarity_search."""
        return await self.vector_store.asimilarity_search(query=query, k=k)

