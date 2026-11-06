from abc import ABC, abstractmethod
from typing import List, Union

class BaseEmbedding(ABC):
    """Abstract base class defining the standard interface for embedding models."""

    @abstractmethod
    def embed(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        """
        Synchronously generate embeddings for a single string or a list of strings.
        
        Args:
            text: A single string (str) or a list of strings (List[str]).
            
        Returns:
            A 1D embedding vector (List[float]) for a single string, 
            or a 2D list of embedding vectors (List[List[float]]) for a list of strings.
        """
        pass

    @abstractmethod
    async def aembed(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        """
        Asynchronously generate embeddings for a single string or a list of strings.
        
        Args:
            text: A single string (str) or a list of strings (List[str]).
            
        Returns:
            A 1D embedding vector (List[float]) for a single string, 
            or a 2D list of embedding vectors (List[List[float]]) for a list of strings.
        """
        pass