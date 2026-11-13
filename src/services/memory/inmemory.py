from typing import Any, Dict
from langgraph.checkpoint.memory import InMemorySaver

_in_memory_checkpointer: InMemorySaver | None = None
_active_threads: Dict[str, Dict[str, Any]] = {}


def get_checkpointer() -> InMemorySaver:
    """Return the global singleton in-memory checkpointer."""
    global _in_memory_checkpointer
    if _in_memory_checkpointer is None:
        _in_memory_checkpointer = InMemorySaver()
    return _in_memory_checkpointer


def get_active_threads_store() -> Dict[str, Dict[str, Any]]:
    """Return the in-memory active conversation threads dictionary."""
    return _active_threads
