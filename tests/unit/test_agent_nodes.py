import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.runnables import RunnableLambda
from langchain_core.documents import Document
from src.agents.nodes.planner import planner_node
from src.agents.nodes.responder import responder_node
from src.agents.nodes.retreiver import retreived_node
from src.agents.models.structure import PlannerStructure


@pytest.mark.asyncio
async def test_planner_node_success():
    mock_res = PlannerStructure(route_to="retriever", queries="kubernetes ingress setup")
    mock_llm = MagicMock()
    mock_llm.with_structured_output.return_value = RunnableLambda(lambda x: mock_res)

    with patch("src.agents.nodes.planner.get_llm", return_value=mock_llm):
        state = {
            "messages": [HumanMessage(content="Hello")],
            "user_message": "How do I configure kubernetes ingress?",
        }
        res = await planner_node(state)
        assert res["route_to"] == "retriever"
        assert res["queries"] == "kubernetes ingress setup"


@pytest.mark.asyncio
async def test_responder_node_general():
    mock_llm = RunnableLambda(lambda x: AIMessage(
        content="Docker is a containerization platform.",
        additional_kwargs={"reasoning_content": "The user asked for a definition."},
    ))

    with patch("src.agents.nodes.responder.get_llm", return_value=mock_llm):
        state = {
            "messages": [],
            "user_message": "What is Docker?",
            "retreived_content": None,
        }
        res = await responder_node(state)
        assert len(res["messages"]) == 2
        assert res["messages"][0].content == "What is Docker?"
        assert res["messages"][1].content == "Docker is a containerization platform."
        assert res["messages"][1].additional_kwargs["reasoning_content"] == "The user asked for a definition."


@pytest.mark.asyncio
async def test_responder_node_retrieved():
    mock_llm = RunnableLambda(lambda x: AIMessage(content="Based on retrieved context, pod is the smallest unit."))

    with patch("src.agents.nodes.responder.get_llm", return_value=mock_llm):
        state = {
            "messages": [],
            "user_message": "What is a Pod?",
            "retreived_content": ["A Pod is the smallest execution unit in Kubernetes."],
        }
        res = await responder_node(state)
        assert len(res["messages"]) == 2
        assert res["messages"][0].content == "What is a Pod?"
        assert "smallest unit" in res["messages"][1].content


@pytest.mark.asyncio
async def test_retriever_node_success():
    with patch("src.agents.nodes.retreiver.vector_store_service.similarity_search", new_callable=AsyncMock) as mock_search, \
         patch("src.agents.nodes.retreiver.reranker_documents", new_callable=AsyncMock) as mock_reranker:
        mock_docs = [
            Document(page_content="Document 1 content", metadata={"source": "one.pdf"}),
            Document(page_content="Document 2 content", metadata={"source": "two.pdf"}),
        ]
        mock_search.return_value = mock_docs
        mock_reranker.return_value = {"reranked_content": mock_docs}

        state = {"queries": "CI/CD best practices"}
        res = await retreived_node(state)
        assert res["retreived_content"] == mock_docs
        assert all(isinstance(document, Document) for document in res["retreived_content"])
        mock_search.assert_awaited_once_with(query="CI/CD best practices", k=15)
        mock_reranker.assert_awaited_once_with(query="CI/CD best practices", documents=mock_docs)
