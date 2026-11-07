"""In-memory session manager for web requests with multi-taxonomy support."""

from __future__ import annotations
import uuid
from typing import Dict, Optional, Tuple

from src.constants import TAXONOMY_CI
from src.core.authority import get_authority
from src.core.model import Filing
from src.services.session import Session
from src.services.example import build_example

_SESSIONS: Dict[str, Session] = {}
_SESSION_TAXONOMIES: Dict[str, str] = {}
_SESSION_META: Dict[str, Dict[str, Any]] = {}


def get_session(session_id: str = "default", taxonomy: Optional[str] = None) -> Session:
    global _SESSIONS, _SESSION_TAXONOMIES
    target_tax = (taxonomy or _SESSION_TAXONOMIES.get(session_id) or TAXONOMY_CI).lower()

    if session_id not in _SESSIONS or (taxonomy and _SESSION_TAXONOMIES.get(session_id) != target_tax):
        A = get_authority(taxonomy=target_tax)
        s = Session(A)
        _SESSION_TAXONOMIES[session_id] = target_tax
        # Only seed with example filing on first load for C&I default
        if session_id == "default" and target_tax == TAXONOMY_CI:
            try:
                build_example(s)
            except Exception:
                pass
        _SESSIONS[session_id] = s

    return _SESSIONS[session_id]


def get_session_taxonomy(session_id: str = "default") -> str:
    return _SESSION_TAXONOMIES.get(session_id, TAXONOMY_CI)


def create_session(session_id: Optional[str] = None, taxonomy: str = TAXONOMY_CI) -> Tuple[str, Session]:
    global _SESSIONS, _SESSION_TAXONOMIES
    sid = session_id or str(uuid.uuid4())
    target_tax = (taxonomy or TAXONOMY_CI).lower()
    A = get_authority(taxonomy=target_tax)
    s = Session(A)
    _SESSIONS[sid] = s
    _SESSION_TAXONOMIES[sid] = target_tax
    return sid, s


def reset_session(session_id: str = "default", taxonomy: str = TAXONOMY_CI) -> Session:
    global _SESSIONS, _SESSION_TAXONOMIES
    target_tax = (taxonomy or TAXONOMY_CI).lower()
    A = get_authority(taxonomy=target_tax)
    s = Session(A)
    _SESSIONS[session_id] = s
    _SESSION_TAXONOMIES[session_id] = target_tax
    return s

