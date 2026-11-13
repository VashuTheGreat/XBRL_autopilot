from typing import Optional
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse

from api.helper.conversation_helper import (
    create_user_conversation,
    delete_user_conversation,
    get_all_threads,
    load_conversation,
)
from api.v1.schemas.chat_schema import ChatRequest, CreateConversationRequest
from src.core.logger import logger
from src.pipeline.chat_agent_pipeline import ChatPipeline

router = APIRouter(prefix="/conversations", tags=["Conversations"])


@router.get(
    "",
    summary="Get all conversation threads",
    responses={
        200: {"description": "List of all active conversation threads"},
        500: {"description": "Internal server error"},
    },
)
async def list_threads():
    """Retrieve all saved conversation threads from in-memory checkpointer."""
    with logger.span("conversations.list_threads"):
        try:
            threads = await get_all_threads()
            return JSONResponse(
                content={
                    "success": True,
                    "count": len(threads),
                    "threads": threads,
                },
                status_code=status.HTTP_200_OK,
            )
        except Exception as e:
            logger.error("conversations.list_failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to list threads: {str(e)}",
            )


@router.post(
    "",
    summary="Create a new conversation thread",
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "Conversation created successfully"},
        500: {"description": "Internal server error"},
    },
)
async def create_thread(payload: Optional[CreateConversationRequest] = None):
    """Create a new in-memory conversation thread."""
    with logger.span("conversations.create_thread"):
        try:
            tid = payload.thread_id if payload else None
            title = payload.title if payload else None
            conversation = create_user_conversation(thread_id=tid, title=title)
            return JSONResponse(
                content={
                    "success": True,
                    "message": "Conversation created successfully",
                    "data": conversation,
                },
                status_code=status.HTTP_201_CREATED,
            )
        except Exception as e:
            logger.error("conversations.create_failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create conversation: {str(e)}",
            )


@router.get(
    "/{thread_id}",
    summary="Get messages for a specific conversation thread",
    responses={
        200: {"description": "Messages retrieved for thread"},
        404: {"description": "Thread not found"},
        500: {"description": "Internal server error"},
    },
)
async def get_thread_conversation(thread_id: str):
    """Retrieve serialized message history for the given thread_id."""
    with logger.span("conversations.get_history", thread_id=thread_id):
        try:
            messages = await load_conversation(thread_id=thread_id)
            if messages is None:
                logger.warning("conversations.thread_not_found", thread_id=thread_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Conversation thread '{thread_id}' not found",
                )
            return JSONResponse(
                content={
                    "success": True,
                    "thread_id": thread_id,
                    "count": len(messages),
                    "messages": messages,
                },
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("conversations.load_failed", thread_id=thread_id, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to load conversation: {str(e)}",
            )


@router.delete(
    "/{thread_id}",
    summary="Delete a conversation thread",
    responses={
        200: {"description": "Thread deleted successfully"},
        404: {"description": "Thread not found"},
        500: {"description": "Internal server error"},
    },
)
async def delete_thread(thread_id: str):
    """Delete a conversation thread and all its state from memory."""
    with logger.span("conversations.delete_thread", thread_id=thread_id):
        try:
            deleted = await delete_user_conversation(thread_id=thread_id)
            if not deleted:
                logger.warning("conversations.thread_not_found_to_delete", thread_id=thread_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Thread '{thread_id}' not found or already deleted",
                )

            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Thread '{thread_id}' deleted successfully",
                },
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("conversations.delete_failed", thread_id=thread_id, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete thread: {str(e)}",
            )


@router.post(
    "/{thread_id}/messages",
    summary="Send a message to a conversation thread",
    responses={
        200: {"description": "AI response or SSE stream"},
        400: {"description": "Invalid input message"},
        404: {"description": "Thread not found"},
        500: {"description": "Internal server error"},
    },
)
async def post_thread_message(thread_id: str, payload: ChatRequest):
    """Send a message to the specified conversation thread."""
    clean_message = payload.message.strip()
    if not clean_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty",
        )

    pipeline = ChatPipeline()
    if not payload.stream:
        with logger.span("conversations.send_message", thread_id=thread_id):
            result = await pipeline.chat(
                message=clean_message,
                thread_id=thread_id,
                metadata=payload.metadata,
            )
            return JSONResponse(content=result, status_code=status.HTTP_200_OK)

    return StreamingResponse(
        pipeline.stream_chat(
            message=clean_message,
            thread_id=thread_id,
            metadata=payload.metadata,
        ),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
