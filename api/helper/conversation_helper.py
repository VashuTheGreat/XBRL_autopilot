import datetime
import uuid
from typing import Any, Dict, List, Optional

from langchain_core.messages import messages_to_dict

from src.core.logger import logger
from src.services.memory.inmemory import get_active_threads_store, get_checkpointer


def create_user_conversation(
    thread_id: Optional[str] = None,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a new conversation session in-memory."""
    active_threads = get_active_threads_store()
    tid = thread_id.strip() if thread_id and thread_id.strip() else f"conv_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    metadata = {
        "thread_id": tid,
        "conversation_id": tid,
        "title": (title.strip() if title and title.strip() else "New Conversation"),
        "created_at": now_iso,
        "updated_at": now_iso,
        "message_count": 0,
    }
    active_threads[tid] = metadata
    logger.info("conversation.created", thread_id=tid, title=metadata["title"])
    return metadata


def conversation_exists(thread_id: str) -> bool:
    """Check if a conversation exists in-memory."""
    active_threads = get_active_threads_store()
    return thread_id in active_threads


async def load_conversation(thread_id: str) -> Optional[List[Dict[str, Any]]]:
    """Retrieve and serialize conversation messages for a given thread_id.

    Returns None if thread does not exist, or a list of message dicts (which may be empty).
    """
    with logger.span("conversation.load", thread_id=thread_id):
        active_threads = get_active_threads_store()
        cp = get_checkpointer()
        config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}

        try:
            state = await cp.aget_tuple(config=config)
        except Exception as e:
            logger.error("conversation.load_failed", thread_id=thread_id, error=str(e))
            state = None

        if state is None or not state.checkpoint:
            if thread_id in active_threads:
                logger.info("conversation.empty_active_thread", thread_id=thread_id)
                return []
            logger.warning("conversation.not_found", thread_id=thread_id)
            return None

        channel_values = state.checkpoint.get("channel_values", {})
        raw_messages = channel_values.get("messages", [])
        serialized_messages = messages_to_dict(raw_messages) if raw_messages else []

        # If thread was not recorded in active_threads, register it
        if thread_id not in active_threads and raw_messages:
            active_threads[thread_id] = {
                "thread_id": thread_id,
                "conversation_id": thread_id,
                "title": (
                    raw_messages[0].content[:40]
                    if hasattr(raw_messages[0], "content")
                    else "Conversation"
                ),
                "created_at": state.checkpoint.get("ts"),
                "updated_at": state.checkpoint.get("ts"),
                "message_count": len(raw_messages),
            }

        logger.info(
            "conversation.loaded",
            thread_id=thread_id,
            message_count=len(serialized_messages),
        )
        return serialized_messages


async def delete_user_conversation(thread_id: str) -> bool:
    """Delete a conversation thread and its in-memory checkpoint state."""
    with logger.span("conversation.delete", thread_id=thread_id):
        active_threads = get_active_threads_store()
        cp = get_checkpointer()
        existed = False

        if thread_id in active_threads:
            active_threads.pop(thread_id, None)
            existed = True

        config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}
        try:
            state = await cp.aget_tuple(config=config)
            if state is not None:
                existed = True
            await cp.adelete_thread(thread_id=thread_id)
        except Exception as e:
            logger.error("conversation.delete_checkpointer_error", thread_id=thread_id, error=str(e))

        if existed:
            logger.info("conversation.deleted", thread_id=thread_id)
            return True

        logger.warning("conversation.delete_not_found", thread_id=thread_id)
        return False


async def get_all_threads() -> List[Dict[str, Any]]:
    """Retrieve all active in-memory conversation threads."""
    with logger.span("conversation.list_all"):
        active_threads = get_active_threads_store()
        cp = get_checkpointer()

        try:
            async for checkpoint_tuple in cp.alist(None):
                cfg = checkpoint_tuple.config.get("configurable", {})
                tid = cfg.get("thread_id")
                if not tid:
                    continue

                checkpoint = checkpoint_tuple.checkpoint or {}
                ts = checkpoint.get("ts")
                channel_values = checkpoint.get("channel_values", {})
                messages = channel_values.get("messages", [])

                title = "New Conversation"
                for msg in messages:
                    content = getattr(msg, "content", "") if hasattr(msg, "content") else ""
                    if not content and isinstance(msg, dict):
                        content = msg.get("content", "")
                    if content:
                        title = content[:40] + ("..." if len(content) > 40 else "")
                        break

                if tid not in active_threads:
                    active_threads[tid] = {
                        "thread_id": tid,
                        "conversation_id": tid,
                        "title": title,
                        "created_at": ts,
                        "updated_at": ts,
                        "message_count": len(messages),
                    }
                else:
                    if len(messages) > active_threads[tid].get("message_count", 0):
                        active_threads[tid]["message_count"] = len(messages)
                        if title != "New Conversation":
                            active_threads[tid]["title"] = title
                    if ts and (not active_threads[tid].get("updated_at") or ts > active_threads[tid]["updated_at"]):
                        active_threads[tid]["updated_at"] = ts
        except Exception as e:
            logger.error("conversation.list_checkpoints_error", error=str(e))

        threads_list = list(active_threads.values())
        logger.info("conversation.threads_retrieved", count=len(threads_list))
        return threads_list
