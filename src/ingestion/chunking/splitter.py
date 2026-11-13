from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from typing import List
from src.core.exception import MyException
from src.core.logger import logger
import sys


def split(documents: List[Document]) -> List[Document]:
    with logger.span("Splitting documents into chunks", doc_count=len(documents)):
        try:
            logger.info("Beginning chunking process", doc_count=len(documents))
            splitter = RecursiveCharacterTextSplitter(
                separators=["\n\n", "\n",". "," ", ""],
                chunk_size=1000,
                chunk_overlap=200,
            )
            chunks = splitter.split_documents(documents=documents)
            logger.info("Document splitting complete", input_docs=len(documents), output_chunks=len(chunks))
            return chunks
        except Exception as e:
            logger.error("Document splitting failed", error=str(e))
            raise MyException(e, sys)
