from langchain_core.documents import Document
from src.core.logger import logger
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.chroma import ChromaVectorDB
from typing import Literal
from src.constants import IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB

huggingface_embedding = None
vector_db = None

def get_vector_db():
    global huggingface_embedding, vector_db
    if vector_db is None:
        huggingface_embedding = HuggingFaceEmbedding()
        vector_db = ChromaVectorDB(embedding_function=huggingface_embedding.embedding_model)
    return vector_db

async def StoreTaxonomies(taxonomies: list[Document],collection:Literal[IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB]):
    with logger.span("ingestion.store_taxonomies", count=len(taxonomies)):
        documents = taxonomies
        db = get_vector_db()
        await db.aadd(documents=documents,collection=collection)
        logger.info("ingestion.store_taxonomies.completed", count=len(taxonomies))