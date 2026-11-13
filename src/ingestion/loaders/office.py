from typing import Iterator, List
from langchain_core.document_loaders.base import BaseLoader
from langchain_core.documents import Document

from src.core.exception import MyException
from src.core.logger import logger
import sys

try:
    from unstructured.partition.auto import partition
except ImportError:
    partition = None


class OfficeLoader(BaseLoader):
    def __init__(self, file_path: str):
        self.file_path = file_path

    def lazy_load(self) -> Iterator[Document]:
        with logger.span("office_loader.lazy_load", file_path=self.file_path):
            if partition is None:
                logger.warning("office_loader.unstructured_not_available", file_path=self.file_path)
                try:
                    with open(self.file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    yield Document(page_content=content, metadata={"source": self.file_path, "page": 0})
                except Exception as e:
                    logger.error("office_loader.fallback_failed", file_path=self.file_path, error=str(e))
                return

            try:
                logger.info("office_loader.partitioning", file_path=self.file_path)
                elements = partition(filename=self.file_path)
                logger.info("office_loader.partitioned", file_path=self.file_path, element_count=len(elements))

                for i, e in enumerate(elements):
                    text = getattr(e, "text", str(e))
                    yield Document(
                        page_content=text,
                        metadata={"source": self.file_path, "page": i},
                    )

                logger.info("office_loader.completed", file_path=self.file_path, elements_loaded=len(elements))

            except Exception as e:
                logger.error("office_loader.failed", file_path=self.file_path, error=str(e))
                raise MyException(e, sys)

    def load(self) -> List[Document]:
        with logger.span("office_loader.load", file_path=self.file_path):
            try:
                docs = list(self.lazy_load())
                logger.info("office_loader.load_complete", file_path=self.file_path, doc_count=len(docs))
                return docs

            except Exception as e:
                logger.error("office_loader.failed", file_path=self.file_path, error=str(e))
                raise MyException(e, sys)


async def office_loader(file_path: str):
    with logger.span("office_loader.async_load", file_path=file_path):
        try:
            logger.info("office_loader.initiating", file_path=file_path)
            loader = OfficeLoader(file_path=file_path)
            docs = await loader.aload()
            logger.info("office_loader.finished", file_path=file_path, doc_count=len(docs))
            return docs

        except Exception as e:
            logger.error("office_loader.failed", file_path=file_path, error=str(e))
            raise MyException(e, sys)
