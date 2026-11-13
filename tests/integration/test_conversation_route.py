import pytest
from unittest.mock import AsyncMock, patch
from langchain_core.messages import AIMessage, HumanMessage, messages_to_dict
from api.helper.conversation_helper import messages_to_dict


def test_messages_to_dict():
    raw = [
        HumanMessage(content="Hello AI"),
        AIMessage(
            content="Hello human!",
            tool_calls=[{"name": "lookup", "args": {"query": "test"}, "id": "call-1", "type": "tool_call"}],
            additional_kwargs={"reasoning": "Use the lookup tool."},
        ),
    ]
    result = messages_to_dict(raw)
    assert result[0]["type"] == "human"
    assert result[0]["data"]["content"] == "Hello AI"
    assert result[1]["type"] == "ai"
    assert result[1]["data"]["content"] == "Hello human!"
    assert result[1]["data"]["tool_calls"][0]["name"] == "lookup"
    assert result[1]["data"]["additional_kwargs"]["reasoning"] == "Use the lookup tool."


def test_list_conversations(client):
    with patch("api.routes.conversation_router.get_all_threads", new_callable=AsyncMock) as mock_get_threads:
        mock_get_threads.return_value = [
            {"thread_id": "t1", "title": "First chat", "created_at": "2026-01-01", "message_count": 2}
        ]
        response = client.get("/api/v1/conversations")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["count"] == 1
        assert data["threads"][0]["thread_id"] == "t1"


def test_get_conversation(client):
    with patch("api.routes.conversation_router.load_conversation", new_callable=AsyncMock) as mock_load:
        mock_load.return_value = [
            {"type": "human", "content": "Tell me a joke"},
            {"type": "ai", "content": "Why did the chicken cross the road?"},
        ]
        response = client.get("/api/v1/conversations/test-t1")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["thread_id"] == "test-t1"
        assert len(data["messages"]) == 2


def test_delete_conversation_success(client):
    with patch("api.routes.conversation_router.delete_user_conversation", new_callable=AsyncMock) as mock_del:
        mock_del.return_value = True
        response = client.delete("/api/v1/conversations/test-t1")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True


def test_delete_conversation_not_found(client):
    with patch("api.routes.conversation_router.delete_user_conversation", new_callable=AsyncMock) as mock_del:
        mock_del.return_value = False
        response = client.delete("/api/v1/conversations/not-found-id")
        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
