from langchain_core.documents import Document
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.chroma import ChromaVectorDB

huggingface_embedding = HuggingFaceEmbedding()

vector_db = ChromaVectorDB(embedding_function=huggingface_embedding.embedding_model)

async def StoreTaxonomies(taxonomies: list[str]):
    documents = [Document(page_content=taxonomy) for taxonomy in taxonomies]
    
    await vector_db.aadd(documents=documents)