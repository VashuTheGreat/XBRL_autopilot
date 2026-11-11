"""Regular expressions and string helpers that behave like JavaScript's.

The formalizer was written in JavaScript, and the rule model it builds must stay identical (ADR-0011 golden
check). Python's ``re`` differs from JS in ways that matter for MCA rule text:
- ``\\w``, ``\\d`` and ``\\b`` are Unicode-aware in Python, ASCII in JS → patterns are compiled with ``re.ASCII``.
- ``\\s`` in JS also matches NBSP, BOM and the Unicode space separators, which Excel text does contain;
  with ``re.ASCII`` Python would miss them → ``\\s`` / ``\\S`` are rewritten to JS's whitespace class.
- ``$`` in Python also matches before a final newline → rewritten to ``\\Z`` (no pattern here uses ``re.M``).
``String.prototype.trim`` is :func:`trim`.
"""
from __future__ import annotations

import re
from functools import lru_cache

# ECMAScript WhiteSpace + LineTerminator (what JS \s and String.prototype.trim use).
_WS = "\t\n\x0b\x0c\r \xa0  -     　﻿"
_WS_CHARS = "".join(
    chr(c) for c in [9, 10, 11, 12, 13, 32, 0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]
)


def _translate(pattern: str) -> str:
    out: list[str] = []
    i, in_class = 0, False
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            nxt = pattern[i + 1]
            if nxt == "s":
                out.append(_WS if in_class else f"[{_WS}]")
            elif nxt == "S":
                if in_class:
                    raise ValueError(r"\S inside a character class is not supported")
                out.append(f"[^{_WS}]")
            else:
                out.append(ch + nxt)
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
        elif ch == "[":
            in_class = True
            out.append(ch)
            i += 1
            # a leading ']' or '^]' is literal inside a class
            if i < len(pattern) and pattern[i] == "^":
                out.append("^")
                i += 1
            continue
        elif ch == "$":
            out.append(r"\Z")
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


@lru_cache(maxsize=None)
def js(pattern: str, ignore_case: bool = False) -> re.Pattern[str]:
    """Compile a JS regular expression source (``/pattern/`` or ``/pattern/i``)."""
    flags = re.ASCII | (re.IGNORECASE if ignore_case else 0)
    return re.compile(_translate(pattern), flags)


def ji(pattern: str) -> re.Pattern[str]:
    """``/pattern/i``."""
    return js(pattern, True)


def trim(s: str) -> str:
    """``String.prototype.trim``."""
    return s.strip(_WS_CHARS)


def collapse_ws(s: str) -> str:
    """``s.replace(/\\s+/g, ' ')``."""
    return js(r"\s+").sub(" ", s)
