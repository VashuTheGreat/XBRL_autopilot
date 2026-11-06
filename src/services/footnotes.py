"""XBRL footnotes (fact-footnote links) service."""

from __future__ import annotations
import re
from typing import Any, Dict, List, Optional, Set

from src.core.richtext import plain_text


def is_empty(t: Any) -> bool:
    cleaned = plain_text(str(t or ""))
    return not re.sub(r"[\s\u00a0]+", "", cleaned)


def list_footnotes(filing: Any) -> List[Dict[str, Any]]:
    return [
        {
            "id": fn.id,
            "text": fn.text,
            "lang": fn.lang or "en",
            "facts": [filing.facts.get(k) for k in fn.fact_keys if filing.facts.get(k)],
        }
        for fn in filing.footnotes.values()
    ]


listFootnotes = list_footnotes


def footnotes_of(filing: Any, fact_key_val: str) -> List[str]:
    return [fn.id for fn in filing.footnotes.values() if fact_key_val in fn.fact_keys]


footnotesOf = footnotes_of


def add_footnote(filing: Any, text: str, fact_keys: Optional[List[str]] = None) -> str:
    t = str(text or "").strip()
    if not t or is_empty(t):
        raise ValueError("Footnote text is empty")
    fact_keys = fact_keys or []
    for k in fact_keys:
        if k not in filing.facts:
            raise ValueError("A footnote can only be attached to a cell that has a value")
    return filing.add_footnote(t, fact_keys, "en")


addFootnote = add_footnote


def update_footnote_text(filing: Any, fn_id: str, text: str) -> None:
    fn = filing.footnotes.get(fn_id)
    if not fn:
        raise ValueError(f"Unknown footnote {fn_id}")
    t = str(text or "").strip()
    if not t or is_empty(t):
        raise ValueError("Footnote text is empty — delete the footnote instead")
    fn.text = t
    filing.revision += 1


updateFootnoteText = update_footnote_text


def link_footnote(filing: Any, fn_id: str, fact_key_val: str) -> None:
    fn = filing.footnotes.get(fn_id)
    if not fn:
        raise ValueError(f"Unknown footnote {fn_id}")
    if fact_key_val not in filing.facts:
        raise ValueError("A footnote can only be attached to a cell that has a value")
    fn.fact_keys.add(fact_key_val)
    filing.revision += 1


linkFootnote = link_footnote


def unlink_footnote(filing: Any, fn_id: str, fact_key_val: str) -> None:
    fn = filing.footnotes.get(fn_id)
    if fn and fact_key_val in fn.fact_keys:
        fn.fact_keys.discard(fact_key_val)
        filing.revision += 1


unlinkFootnote = unlink_footnote


def remove_footnote(filing: Any, fn_id: str) -> bool:
    if fn_id in filing.footnotes:
        del filing.footnotes[fn_id]
        filing.revision += 1
        return True
    return False


removeFootnote = remove_footnote
