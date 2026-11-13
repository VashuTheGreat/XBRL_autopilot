import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from api.v1.schemas.chat_schema import ChatRequest
from src.core.logger import logger
from src.pipeline.chat_agent_pipeline import ChatPipeline
from src.services.llm_provider.groq import AVAILABLE_MODELS, DEFAULT_MODEL

router = APIRouter(tags=["Chat"])

# Alias for backward compatibility if imported elsewhere
stream_chat = ChatPipeline.stream_chat


@router.post(
    "/chat",
    summary="Chat with the In-Memory RAG Agent (SSE Stream or JSON)",
    responses={
        200: {"description": "Server-Sent Events stream or JSON response with AI answer."},
        400: {"description": "Validation error."},
        422: {"description": "Unsupported model selection."},
        500: {"description": "Pipeline execution error."},
    },
)
async def run_workflow(request: Request, payload: ChatRequest):
    """Send a message to the in-memory XBRL chatbot pipeline.

    Supports both streaming (SSE) and direct JSON response depending on `payload.stream`.
    """
    # Resolve thread_id from payload, headers, or query params
    thread_id = (
        payload.thread_id
        or payload.conversation_id
        or request.query_params.get("thread_id")
        or request.query_params.get("conversation_id")
        or request.headers.get("x-thread-id")
        or request.headers.get("thread_id")
        or getattr(request.state, "thread_id", None)
        or f"conv_{uuid.uuid4().hex[:12]}"
    )

    clean_message = payload.message.strip()
    if not clean_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty",
        )

    metadata = payload.metadata or {}
    model = metadata.get("model", DEFAULT_MODEL)
    if model not in AVAILABLE_MODELS:
        return JSONResponse(
            content={"error": f"Unsupported model selection: {model}"},
            status_code=422,
        )

    with logger.span("chat.endpoint", thread_id=thread_id, stream=payload.stream, model=model):
        try:
            logger.info("chat.request_received", thread_id=thread_id, stream=payload.stream)
            pipeline = ChatPipeline()

            # Non-streaming response
            if not payload.stream:
                result = await pipeline.chat(
                    message=clean_message,
                    thread_id=thread_id,
                    metadata=metadata,
                )
                logger.info("chat.response_ready", thread_id=thread_id)
                return JSONResponse(content=result, status_code=status.HTTP_200_OK)

            # Streaming response
            logger.info("chat.streaming_started", thread_id=thread_id)
            return StreamingResponse(
                pipeline.stream_chat(
                    message=clean_message,
                    thread_id=thread_id,
                    metadata=metadata,
                ),
                media_type="text/event-stream",
                headers={
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        except Exception as e:
            logger.error("chat.endpoint_failed", thread_id=thread_id, error=str(e))
            return JSONResponse(content={"error": str(e)}, status_code=500)
