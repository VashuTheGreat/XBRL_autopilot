import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.documents import Document

from src.service.embedding.base import BaseEmbeddingService
from src.service.embedding.sentence_transformer import SentenceTransformerEmbedding
from src.service.vector_store.base import BaseVectorStore
from src.service.vector_store.qdrant import QdrantVectorStore
from src.service.vector_store.pinecone import PineconeVectorStore
from src.service.vector_store import get_vector_store


class DummyEmbeddingService(BaseEmbeddingService):
    """Mock implementation of BaseEmbeddingService for testing."""
    def embed_documents(self, texts):
        return [[0.1, 0.2, 0.3] for _ in texts]

    def embed_query(self, text):
        return [0.1, 0.2, 0.3]


def test_embedding_service_abc():
    """Verify that BaseEmbeddingService enforces abstract methods."""
    class IncompleteEmbedder(BaseEmbeddingService):
        pass

    with pytest.raises(TypeError):
        IncompleteEmbedder()


def test_sentence_transformer_mocked():
    """Verify SentenceTransformerEmbedding delegates to underlying model."""
    embedder = SentenceTransformerEmbedding(model_name="dummy-model")
    mock_model = MagicMock()
    mock_model.encode.return_value = MagicMock(tolist=lambda: [0.5, 0.5])
    embedder._model = mock_model

    vec = embedder.embed_query("test query")
    assert vec == [0.5, 0.5]
    mock_model.encode.assert_called_once_with("test query")


def test_sentence_transformer_loads_cached_model_without_hub_requests():
    embedder = SentenceTransformerEmbedding(model_name="dummy-model")
    mock_model = MagicMock()

    with patch("sentence_transformers.SentenceTransformer", return_value=mock_model) as model_loader:
        assert embedder._get_model() is mock_model

    model_loader.assert_called_once_with("dummy-model", local_files_only=True)


def test_sentence_transformer_downloads_model_when_not_cached():
    embedder = SentenceTransformerEmbedding(model_name="dummy-model")
    mock_model = MagicMock()

    with patch(
        "sentence_transformers.SentenceTransformer",
        side_effect=[OSError("model is not cached"), mock_model],
    ) as model_loader:
        assert embedder._get_model() is mock_model

    assert model_loader.call_args_list[0].kwargs == {"local_files_only": True}
    assert model_loader.call_args_list[1].args == ("dummy-model",)


def test_vector_store_abc():
    """Verify that BaseVectorStore enforces abstract methods."""
    class IncompleteVectorStore(BaseVectorStore):
        pass

    with pytest.raises(TypeError):
        IncompleteVectorStore()


@pytest.mark.asyncio
async def test_qdrant_vector_store_dependency_injection():
    """Verify QdrantVectorStore accepts a custom embedding service."""
    custom_embedder = DummyEmbeddingService()
    vs = QdrantVectorStore(
        collection_name="test_collection",
        url="http://localhost:6333",
        embedding_service=custom_embedder,
    )
    assert vs.embedder is custom_embedder

    mock_client = AsyncMock()
    mock_client.collection_exists.return_value = True
    mock_client.upsert = AsyncMock(return_value=True)
    vs._async_client = mock_client

    docs = [Document(page_content="hello world", metadata={"source": "test"})]
    result = await vs.upsert(docs)

    assert result == True
    mock_client.upsert.assert_awaited_once()
    call_args = mock_client.upsert.call_args[1]
    assert call_args["collection_name"] == "test_collection"
    assert len(call_args["points"]) == 1
    assert call_args["points"][0].vector == [0.1, 0.2, 0.3]
    assert call_args["points"][0].payload["page_content"] == "hello world"


def test_get_vector_store_factory():
    """Test get_vector_store factory."""
    custom_embedder = DummyEmbeddingService()
    qdrant_store = get_vector_store("qdrant", embedding_service=custom_embedder)
    assert isinstance(qdrant_store, QdrantVectorStore)

    pinecone_store = get_vector_store("pinecone", embedding_service=custom_embedder)
    assert isinstance(pinecone_store, PineconeVectorStore)

    with pytest.raises(ValueError):
        get_vector_store("unsupported_db")
