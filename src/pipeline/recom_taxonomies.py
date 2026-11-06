from langchain_core.documents import Document
from src.services.embeddings.huggingface import HuggingFaceEmbedding
from src.services.vectordb.chroma import ChromaVectorDB

huggingface_embedding = HuggingFaceEmbedding()

vector_db = ChromaVectorDB(embedding_function=huggingface_embedding.embedding_model)

async def RecommendTaxonomies(keys: list[str])->list[Document]:
    ans = []
    for key in keys:
        documents = await vector_db.asearch(query=key)
        ans.append(documents[0])
    
    return ans