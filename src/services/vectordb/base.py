from abc import ABC, abstractmethod
from typing import List
from langchain_core.documents import Document

class BaseVectorDB(ABC):
    """Abstract base class defining the standard interface for vector databases."""

    @abstractmethod
    def add(self, documents: List[Document]) -> List[str]:
        """Synchronously add documents to the database."""
        pass

    @abstractmethod
    async def aadd(self, documents: List[Document]) -> List[str]:
        """Asynchronously add documents to the database."""
        pass

    @abstractmethod
    def search(self, query: str, k: int) -> List[Document]:
        """Synchronously search the database for relevant documents."""
        pass

    @abstractmethod
    async def asearch(self, query: str, k: int) -> List[Document]:
        """Asynchronously search the database for relevant documents."""
        pass