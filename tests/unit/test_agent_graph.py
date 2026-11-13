import pytest
from unittest.mock import AsyncMock, patch
from langchain_core.messages import HumanMessage, AIMessage
from src.agents.graph import create_agent_graph, route_decision, guardrail_decision


def test_graph_structure():
    compiled_graph = create_agent_graph()
    nodes = list(compiled_graph.nodes.keys())
    assert "guardrail" not in nodes
    assert "blocked_responder" not in nodes
    assert "planner" in nodes
    assert "retriever" in nodes
    assert "responder" in nodes


def test_guardrail_decision():
    assert guardrail_decision({"is_blocked": True}) == "blocked_responder"
    assert guardrail_decision({"is_blocked": False}) == "planner"
    assert guardrail_decision({}) == "planner"


def test_route_decision():
    assert route_decision({"route_to": "retriever"}) == "retriever"
    assert route_decision({"route_to": "responder"}) == "responder"
    assert route_decision({}) == "responder"
    assert route_decision({"route_to": "unknown"}) == "responder"


@pytest.mark.asyncio
async def test_graph_execution_direct_responder():
    async def mock_guardrail(state):
        return {"is_blocked": False}

    async def mock_planner(state):
        return {"route_to": "responder"}

    async def mock_responder(state):
        user_msg = state.get("user_message")
        return {"messages": [HumanMessage(content=user_msg), AIMessage(content="Direct answer")]}

    mock_retriever = AsyncMock()

    with patch("src.agents.graph.guardrail_node", side_effect=mock_guardrail), \
         patch("src.agents.graph.planner_node", side_effect=mock_planner), \
         patch("src.agents.graph.responder_node", side_effect=mock_responder), \
         patch("src.agents.graph.retreived_node", mock_retriever):

        test_graph = create_agent_graph()
        result = await test_graph.ainvoke({
            "user_message": "What is Python?",
            "messages": [],
        })

        assert "messages" in result
        assert len(result["messages"]) == 2
        assert result["messages"][0].content == "What is Python?"
        assert result["messages"][1].content == "Direct answer"
        mock_retriever.assert_not_called()


@pytest.mark.asyncio
async def test_graph_execution_retriever_flow():
    async def mock_guardrail(state):
        return {"is_blocked": False}

    async def mock_planner(state):
        return {"route_to": "retriever", "queries": "kubernetes architecture"}

    async def mock_retriever(state):
        assert state.get("queries") == "kubernetes architecture"
        return {"retreived_content": ["Kubernetes control plane and worker nodes."]}

    async def mock_responder(state):
        assert state.get("retreived_content") == ["Kubernetes control plane and worker nodes."]
        return {"messages": [HumanMessage(content="Tell me k8s"), AIMessage(content="RAG answer")]}

    with patch("src.agents.graph.guardrail_node", side_effect=mock_guardrail), \
         patch("src.agents.graph.planner_node", side_effect=mock_planner), \
         patch("src.agents.graph.responder_node", side_effect=mock_responder), \
         patch("src.agents.graph.retreived_node", side_effect=mock_retriever):

        test_graph = create_agent_graph()
        result = await test_graph.ainvoke({
            "user_message": "Tell me k8s",
            "messages": [],
        })

        assert "messages" in result
        assert len(result["messages"]) == 2
        assert result["messages"][1].content == "RAG answer"


@pytest.mark.asyncio
async def test_graph_execution_out_of_scope_input_uses_planner_route():
    async def mock_planner(state):
        return {"route_to": "responder"}

    async def mock_responder(state):
        user_msg = state.get("user_message")
        return {"messages": [HumanMessage(content=user_msg), AIMessage(content="Mocked response")]}

    with patch("src.agents.graph.planner_node", side_effect=mock_planner), \
         patch("src.agents.graph.responder_node", side_effect=mock_responder):
        test_graph = create_agent_graph()
        result = await test_graph.ainvoke({
            "user_message": "Tell me a birthday speech",
            "messages": [],
        })

        assert "messages" in result
        assert len(result["messages"]) == 2
        assert result["messages"][1].content == "Mocked response"


