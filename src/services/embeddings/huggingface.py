from typing import List, Union
from .base import BaseEmbedding
from langchain_huggingface import HuggingFaceEmbeddings

class HuggingFaceEmbedding(BaseEmbedding):
    def __init__(
        self, 
        model_name: str = "sentence-transformers/all-mpnet-base-v2",
        **kwargs
    ):
        super().__init__()
        self.model_name = model_name
        self.embedding_model = HuggingFaceEmbeddings(model_name=model_name, **kwargs)

    def embed(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        """Synchronous embedding method for a single string or a list of strings."""
        if isinstance(text, str):
            return self.embedding_model.embed_query(text)
        elif isinstance(text, list):
            return self.embedding_model.embed_documents(text)
        raise ValueError("Input must be a string (str) or a list of strings (list[str]).")

    async def aembed(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        """Asynchronous embedding method for a single string or a list of strings."""
        if isinstance(text, str):
            return await self.embedding_model.aembed_query(text)
        elif isinstance(text, list):
            return await self.embedding_model.aembed_documents(text)
        raise ValueError("Input must be a string (str) or a list of strings (list[str]).")

    async def embedd(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        return await self.aembed(text)