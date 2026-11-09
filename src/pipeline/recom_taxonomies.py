from langchain_core.documents import Document
from src.core.logger import logger
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.chroma import ChromaVectorDB
from typing import Literal
from src.constants import IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB
from src.utils.main_utils import restore_metadata
huggingface_embedding = None
vector_db = None

def get_vector_db():
    global huggingface_embedding, vector_db
    if vector_db is None:
        huggingface_embedding = HuggingFaceEmbedding()
        vector_db = ChromaVectorDB(embedding_function=huggingface_embedding.embedding_model)
    return vector_db

async def RecommendTaxonomies(keys: list[str],collection:Literal[IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB]) -> list[Document]:
    with logger.span("pipeline.recommend_taxonomies", keys_count=len(keys)):
        db = get_vector_db()
        ans = []
        for key in keys:
            documents = await db.asearch(query=key, collection=collection)
            if documents:
                doc = documents[0]
                doc.metadata = restore_metadata(doc.metadata)
                ans.append(doc)
            else:
                ans.append(None)
        logger.info("pipeline.recommend_taxonomies.completed", results_count=len(ans))
        return ans