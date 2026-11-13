from langchain_core.document_loaders.base import BaseLoader
from langchain_core.documents import Document
from typing import Iterator, List
from src.core.exception import MyException
from src.core.logger import logger
import sys


class TextLoader(BaseLoader):
    def __init__(self, file_path: str):
        self.file_path = file_path

    def lazy_load(self) -> Iterator[Document]:
        try:
            logger.info("Opening text file", file_path=self.file_path)
            with open(file=self.file_path, encoding="utf-8", errors="ignore") as f:
                content = f.read()
            logger.info("Text file read successfully", file_path=self.file_path, char_count=len(content))
            yield Document(page_content=content, metadata={"source": self.file_path, "page": 0})
            logger.info("Text lazy load complete", file_path=self.file_path)
        except Exception as e:
            logger.error("Failed to lazy load text file", file_path=self.file_path, error=str(e))
            raise MyException(e, sys)

    def load(self) -> List[Document]:
        with logger.span("Loading text file into memory: {file_path}", file_path=self.file_path):
            try:
                docs = list(self.lazy_load())
                logger.info("Text file load complete", file_path=self.file_path, doc_count=len(docs))
                return docs

            except Exception as e:
                logger.error("Failed to load text file", file_path=self.file_path, error=str(e))
                raise MyException(e, sys)


async def text_loader(file_path: str):
    with logger.span("Async text loader: {file_path}", file_path=file_path):
        try:
            logger.info("Initiating text file load", file_path=file_path)
            loader = TextLoader(file_path=file_path)
            docs = await loader.aload()
            logger.info("Async text load finished", file_path=file_path, doc_count=len(docs))
            return docs

        except Exception as e:
            logger.error("Async text loader failed", file_path=file_path, error=str(e))
            raise MyException(e, sys)
