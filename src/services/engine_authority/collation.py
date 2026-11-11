"""Sort keys that order strings exactly like JavaScript's ``String.prototype.localeCompare``.

The engine authority used to be compiled in TypeScript, which sorted with ``localeCompare`` (ICU root
collation). The Python build must give the same order so the authority, and therefore the generated XML,
is identical. For ASCII, ICU compares primary weights over the whole string first (punctuation before
digits before letters, letters case-insensitive), then case (lowercase first). Characters outside ASCII
sort after it by code point.
"""
from __future__ import annotations

# ICU root collation order of printable ASCII (case pairs share a primary weight).
_ICU_ASCII = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ"


def _weights() -> dict[str, int]:
    weights: dict[str, int] = {}
    rank = 0
    for ch in _ICU_ASCII:
        if ch.isalpha() and ch.isupper():
            weights[ch] = weights[ch.lower()]
            continue
        rank += 1
        weights[ch] = rank
    return weights


_PRIMARY = _weights()
_BASE = len(_ICU_ASCII) + 1


def locale_key(s: str) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Key for ``sorted`` that reproduces ``a.localeCompare(b)`` for the taxonomy's identifiers."""
    primary = tuple(_PRIMARY.get(ch, _BASE + ord(ch)) for ch in s)
    case = tuple(1 if ch.isupper() else 0 for ch in s)
    return primary, case


def sort_obj(d: dict) -> dict:
    """A dict with its keys in ``localeCompare`` order (the TS compiler's ``sortObj``)."""
    return {k: d[k] for k in sorted(d, key=locale_key)}
