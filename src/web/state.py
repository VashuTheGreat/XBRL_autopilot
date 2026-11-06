"""In-memory session manager for web requests."""

from __future__ import annotations
import uuid
from typing import Dict, Optional, Tuple

from src.core.authority import get_authority
from src.core.model import Filing
from src.services.session import Session
from src.services.example import build_example

_SESSIONS: Dict[str, Session] = {}


def get_session(session_id: str = "default") -> Session:
    if session_id not in _SESSIONS:
        A = get_authority()
        s = Session(A)
        # Seed with example filing on first load
        build_example(s)
        _SESSIONS[session_id] = s
    return _SESSIONS[session_id]


def create_session(session_id: Optional[str] = None) -> Tuple[str, Session]:
    sid = session_id or str(uuid.uuid4())
    A = get_authority()
    s = Session(A)
    _SESSIONS[sid] = s
    return sid, s


def reset_session(session_id: str = "default") -> Session:
    A = get_authority()
    s = Session(A)
    _SESSIONS[session_id] = s
    return s
