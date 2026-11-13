from typing import Any, Dict, Optional
from pydantic import BaseModel, Field, field_validator


class CreateConversationRequest(BaseModel):
    title: Optional[str] = Field(None, description="Optional conversation title")
    thread_id: Optional[str] = Field(None, description="Optional custom conversation/thread ID")


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User message content (cannot be empty)")
    stream: bool = Field(True, description="Enable streaming Server-Sent Events (SSE)")
    thread_id: Optional[str] = Field(None, description="Target conversation thread ID")
    conversation_id: Optional[str] = Field(None, description="Alias for thread_id")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Optional metadata dictionary")

    @field_validator("message")
    @classmethod
    def validate_non_empty_message(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Message cannot be empty or whitespace only")
        return clean
