import sys
from typing import Iterator, List
from langchain_core.document_loaders.base import BaseLoader
from langchain_core.documents import Document

from src.core.exception import MyException
from src.core.logger import logger

try:
    import pymupdf
except ImportError:
    pymupdf = None


class PdfLoader(BaseLoader):
    def __init__(self, file_path: str):
        self.file_path = file_path

    def lazy_load(self) -> Iterator[Document]:
        if pymupdf is None:
            logger.warning("pdf_loader.pymupdf_not_installed", file_path=self.file_path)
            return

        docs = None
        try:
            logger.info("pdf_loader.opening", file_path=self.file_path)
            docs = pymupdf.open(self.file_path)
            page_count = len(docs)
            logger.info("pdf_loader.opened", file_path=self.file_path, page_count=page_count)

            for i, page in enumerate(docs):
                text = page.get_text()
                if isinstance(text, bytes):
                    text = text.decode("utf-8", errors="ignore")
                logger.debug("pdf_loader.page_read", file_path=self.file_path, page=i, char_count=len(text))
                yield Document(
                    page_content=text,
                    metadata={
                        "source": self.file_path,
                        "page": i,
                    },
                )

            logger.info("pdf_loader.completed", file_path=self.file_path, pages_loaded=page_count)

        except Exception as e:
            logger.error("pdf_loader.failed", file_path=self.file_path, error=str(e))
            raise MyException(e, sys)
        finally:
            if docs:
                docs.close()

    def load(self) -> List[Document]:
        with logger.span("pdf_loader.load", file_path=self.file_path):
            try:
                docs = list(self.lazy_load())
                logger.info("pdf_loader.load_complete", file_path=self.file_path, doc_count=len(docs))
                return docs

            except Exception as e:
                logger.error("pdf_loader.failed", file_path=self.file_path, error=str(e))
                raise MyException(e, sys)


async def pdf_loader(file_path: str):
    with logger.span("pdf_loader.async_load", file_path=file_path):
        try:
            logger.info("pdf_loader.initiating", file_path=file_path)
            loader = PdfLoader(file_path=file_path)
            docs = await loader.aload()
            logger.info("pdf_loader.finished", file_path=file_path, doc_count=len(docs))
            return docs

        except Exception as e:
            logger.error("pdf_loader.failed", file_path=file_path, error=str(e))
            raise MyException(e, sys)
