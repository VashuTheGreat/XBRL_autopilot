"""Classify an ELR (extended link role) into the group the UI shows: Statements, Notes or Disclosures.

The ELR *code* can't be used: each taxonomy numbers differently (C&I: 2xxxxx/3xxxxx are notes; Ind AS: 4xxxxx-7xxxxx mix
notes, statements and disclosures; Costing: everything is 1xxxxx). The *title* wording is consistent across all MCA
taxonomies: "Notes - ...", "Disclosure(s) ...", and everything else is a statement or report section.
"""
import re

STATEMENTS = "Statements"
NOTES = "Notes"
DISCLOSURES = "Disclosures"

_NOTES = re.compile(r"^\s*notes?\b", re.IGNORECASE)
_DISCLOSURES = re.compile(r"^\s*disclosures?\b", re.IGNORECASE)
_CODE_PREFIX = re.compile(r"^\s*\[[^\]]+\]\s*")


def elr_title(definition: str) -> str:
    """'[100100] Balance sheet' -> 'Balance sheet'."""
    return _CODE_PREFIX.sub("", definition or "").strip()


def elr_code(definition: str) -> str | None:
    """'[210000a] Statement of profit and loss' -> '210000a'."""
    m = re.match(r"^\s*\[([0-9]{6}[a-zA-Z]?)\]", definition or "")
    return m.group(1) if m else None


def classify_elr(title: str) -> str:
    t = elr_title(title)
    if _NOTES.match(t):
        return NOTES
    if _DISCLOSURES.match(t):
        return DISCLOSURES
    return STATEMENTS
