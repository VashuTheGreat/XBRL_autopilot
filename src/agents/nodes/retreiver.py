import sys
from typing import List
from langchain_core.documents import Document
from langsmith import traceable

from src.app_config import get_app_config
from src.constants import XBRL_AGENT_VDB
from src.core.exception import MyException
from src.core.logger import logger
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.retrieval.reranker import flaskreranker
from src.services.vectordb.qdrant import get_qdrant_service
from ..models.state import AgentState

observe = traceable


def _get_vector_store():
    embedder = HuggingFaceEmbedding()
    return get_qdrant_service(collection_name=XBRL_AGENT_VDB, embedding_service=embedder)


async def reranker_documents(query: str, documents: List[Document]):
    """Rerank retrieved documents using the reranker service."""
    return await flaskreranker(query=query, documents=documents)


@observe(name="retriever_node", run_type="retriever")
async def retreived_node(state: AgentState):
    """Fetch relevant similar documents according to the planned query."""
    queries = state.get("queries") or state.get("user_message") or ""
    with logger.span("retriever.execution", query=queries):
        try:
            logger.info("retriever.querying_vector_store", collection=XBRL_AGENT_VDB, query=queries)
            vector_store = _get_vector_store()
            documents = await vector_store.similarity_search(query=queries, k=15)
            doc_count = len(documents) if documents else 0

            if doc_count and queries:
                logger.info("retriever.reranking_documents", count=doc_count, query=queries)
                reranked = await reranker_documents(query=queries, documents=documents)
                documents = reranked.get("reranked_content", documents)

            logger.info("retriever.completed", count=len(documents) if documents else 0)
            def _clean_meta(meta: dict) -> dict:
                clean = {}
                for k, v in meta.items():
                    if hasattr(v, "item"):
                        clean[k] = v.item()
                    elif hasattr(v, "__float__") and not isinstance(v, (int, float, str, bool)):
                        clean[k] = float(v)
                    else:
                        clean[k] = v
                return clean

            serializable_docs = [
                {
                    "page_content": d.page_content if hasattr(d, "page_content") else str(d),
                    "metadata": _clean_meta(d.metadata) if hasattr(d, "metadata") and isinstance(d.metadata, dict) else {},
                }
                for d in (documents or [])
            ]
            return {"retreived_content": serializable_docs}
        except Exception as e:
            logger.error("retriever.failed", error=str(e))
            raise MyException(e, sys)
