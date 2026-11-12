"""Small building blocks shared by the formalizer modules."""
from __future__ import annotations

from typing import Any


class _Undefined:
    """JavaScript ``undefined``: a key holding it is left out of the JSON (``null`` is kept)."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __bool__(self) -> bool:
        return False

    def __repr__(self) -> str:
        return "UNDEF"


UNDEF: Any = _Undefined()


def strip_undef(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: strip_undef(v) for k, v in x.items() if v is not UNDEF}
    if isinstance(x, list):
        return [None if v is UNDEF else strip_undef(v) for v in x]
    return x


def cmp(op: str, l: Any, r: Any, **extra: Any) -> dict:
    return {"op": "cmp", "cmp": op, **extra, "l": l, "r": r} if extra else {"op": "cmp", "cmp": op, "l": l, "r": r}


def entered(e: dict) -> dict:
    return {"op": "entered", "e": e}


def const(v: Any) -> dict:
    return {"const": v}


SELF = {"self": True}


def nd(q: str | None) -> dict:
    """A non-dimensional fact operand."""
    return {"fact": q, "ctx": "nondim"}


def is_nondim_only(q: str, A: dict) -> bool:
    return not (A.get("conceptHypercubes", {}).get(q) or [])


def default_scope() -> dict:
    """Mandatory facts are evaluated for CY, and for PY unless the concept's ELRs are excluded for the previous
    year by the generic rule (handled at runtime); the scope lists the candidate periods."""
    return {"periods": ["CY", "PY"]}


def executable(impl: str, ast: dict, scope: dict | None = None) -> dict:
    return {"status": "EXECUTABLE", "implementation": impl, "ast": ast, "scope": scope or default_scope()}
