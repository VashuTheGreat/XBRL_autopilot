from typing import List, Union
from .base import BaseEmbedding
from langchain_huggingface import HuggingFaceEmbeddings
from src.core.logger import logger

class HuggingFaceEmbedding(BaseEmbedding):
    def __init__(
        self,
        model_name: str = "sentence-transformers/all-mpnet-base-v2",
        **kwargs
    ):
        super().__init__()
        self.model_name = model_name
        with logger.span("embeddings.init", model_name=model_name):
            self.embedding_model = HuggingFaceEmbeddings(model_name=model_name, **kwargs)

    def embed(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        with logger.span("embeddings.embed", is_batch=isinstance(text, list)):
            if isinstance(text, str):
                return self.embedding_model.embed_query(text)
            elif isinstance(text, list):
                return self.embedding_model.embed_documents(text)
            logger.error("embeddings.invalid_input", input_type=type(text).__name__)
            raise ValueError("Input must be a string (str) or a list of strings (list[str]).")

    async def aembed(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        with logger.span("embeddings.aembed", is_batch=isinstance(text, list)):
            if isinstance(text, str):
                return await self.embedding_model.aembed_query(text)
            elif isinstance(text, list):
                return await self.embedding_model.aembed_documents(text)
            logger.error("embeddings.invalid_input", input_type=type(text).__name__)
            raise ValueError("Input must be a string (str) or a list of strings (list[str]).")

    async def embedd(self, text: Union[str, List[str]]) -> Union[List[float], List[List[float]]]:
        return await self.aembed(text)