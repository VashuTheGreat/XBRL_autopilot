import json
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage, AIMessage, AIMessageChunk
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatGenerationChunk, ChatResult

from src.agents.graph import create_agent_graph


class FakeStreamingChatModel(BaseChatModel):
    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        raise NotImplementedError()

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        chunk_reasoning = ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                additional_kwargs={"reasoning_content": "Analyzing user inquiry..."},
            )
        )
        if run_manager:
            await run_manager.on_llm_new_token("", chunk=chunk_reasoning)

        tokens = ["<think>", "Internal deliberations", "</think>", "This is the final response."]
        for t in tokens:
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=t))
            if run_manager:
                await run_manager.on_llm_new_token(t, chunk=chunk)

        return ChatResult(
            generations=[
                ChatGenerationChunk(
                    message=AIMessageChunk(content="This is the final response.")
                )
            ]
        )

    @property
    def _llm_type(self):
        return "fake_streaming_chat_model"


def parse_sse_events(sse_text: str):
    """Parse SSE raw text into a list of (event_type, json_data) tuples."""
    events = []
    current_event = "message"
    for line in sse_text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("event:"):
            current_event = line.replace("event:", "").strip()
        elif line.startswith("data:"):
            data_str = line.replace("data:", "").strip()
            data = json.loads(data_str)
            events.append((current_event, data))
    return events


def test_chat_unauthenticated(client):
    """Chat endpoint should reject unauthenticated requests without user_id / thread_id."""
    response = client.post(
        "/api/v1/chat",
        json={"message": "Hello"},
    )
    assert response.status_code == 401


def test_chat_streaming_success(client):
    """Chat endpoint should stream reasoning, tool_start/tool_end, token, and final SSE events."""
    async def mock_planner(state):
        return {"route_to": "retriever", "queries": "kubernetes ingress"}

    async def mock_retriever(state):
        return {"retreived_content": ["Document snippet about ingress"]}

    fake_llm = FakeStreamingChatModel()

    with patch("src.agents.graph.planner_node", side_effect=mock_planner), \
            patch("src.agents.nodes.responder.get_llm", return_value=fake_llm) as mock_get_llm, \
         patch("src.agents.graph.retreived_node", side_effect=mock_retriever):

        test_graph = create_agent_graph()
        with patch("api.routes.chat_router.get_graph", return_value=test_graph):
            response = client.post(
                "/api/v1/chat",
                headers={"x-user-id": "usr_123", "x-thread-id": "thr_456"},
                json={
                    "message": "How does ingress work?",
                    "stream": True,
                    "metadata": {"model": "openai/gpt-oss-20b"},
                },
            )

            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")

            events = parse_sse_events(response.text)
            payloads = [ev[1] for ev in events if isinstance(ev[1], dict)]
            payload_types = [p.get("type") for p in payloads]

            assert "reasoning" in payload_types
            reasoning_contents = [p.get("content") for p in payloads if p.get("type") == "reasoning"]
            assert any("analyzing" in c.lower() for c in reasoning_contents)

            assert "tool_start" in payload_types
            assert any(p.get("tool") == "retriever" for p in payloads if p.get("type") == "tool_start")
            assert "tool_end" in payload_types
            assert any(p.get("tool") == "retriever" for p in payloads if p.get("type") == "tool_end")

            assert "token" in payload_types
            token_contents = "".join([p.get("content", "") for p in payloads if p.get("type") == "token"])
            assert "This is the final response." in token_contents

            assert "final" in payload_types
            final_payload = next(p for p in payloads if p.get("type") == "final")
            assert "This is the final response." in final_payload.get("ai_response", "")
            assert final_payload.get("state") == "completed"
            mock_get_llm.assert_called_once_with(model="openai/gpt-oss-20b")


def test_chat_non_streaming_success(client):
    """Chat endpoint should support non-streaming JSON responses when stream=False."""
    async def mock_planner(state):
        return {"route_to": "responder"}

    async def mock_responder(state):
        return {
            "messages": [
                HumanMessage(content=state.get("user_message")),
                AIMessage(content="Direct JSON answer"),
            ],
            "retreived_content": [
                type("FakeDocument", (), {"page_content": "Retrieved DevOps context"})()
            ],
        }

    with patch("src.agents.graph.planner_node", side_effect=mock_planner), \
         patch("src.agents.graph.responder_node", side_effect=mock_responder):

        test_graph = create_agent_graph()
        with patch("api.routes.chat_router.get_graph", return_value=test_graph):
            response = client.post(
                "/api/v1/chat",
                headers={"x-user-id": "usr_123", "x-thread-id": "thr_456"},
                json={"message": "What is Python?", "stream": False},
            )

            assert response.status_code == 200
            data = response.json()
            assert data.get("success") is True
            assert data.get("response") == "Direct JSON answer"
            assert data.get("data", {}).get("retreived_content") == ["Retrieved DevOps context"]


def test_chat_graph_unconfigured(client):
    """Chat endpoint should handle missing graph configuration gracefully."""
    with patch("api.routes.chat_router.get_graph", side_effect=Exception("Config error")):

        response = client.post(
            "/api/v1/chat",
            headers={"x-user-id": "usr_123", "x-thread-id": "thr_456"},
            json={"message": "Hello", "stream": False},
        )
        assert response.status_code == 500
        assert "error" in response.json()
