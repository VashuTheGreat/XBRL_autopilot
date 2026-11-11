"""Second privacy check of a fix bundle, right before anything goes to the LLM (ADR-0012, docs/11).

The desktop app builds the bundle without identity data (ui/shared/privacy.ts); this check refuses a bundle that still
carries any: facts of identity elements (CIN, names, PAN, DIN, addresses …), text values over 200 characters, text
blocks other than the problem's own fact, or a CIN / PAN anywhere in its text. ``IDENTITY_ELEMENT`` must stay equal
to ``IDENTITY_ELEMENT`` in ui/shared/privacy.ts (tests/test_fix_agent.py compares them).
"""
from __future__ import annotations

import re
from typing import Any, Iterator

from src.services.fix_agent.bundle import MAX_TEXT, FixRequest

IDENTITY_ELEMENT = re.compile(
    r"(IdentityNumber|IdentificationNumber|PermanentAccountNumber|PAN|Name(Of|$)|^(First|Middle|Last)Name|Address|Email"
    r"|Phone|Mobile|Fax|Website|Pin[Cc]ode|MembershipNumber|RegistrationNumber|DateOfBirth)"
)
CIN = re.compile(r"\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b")
PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")


class PrivacyError(ValueError):
    def __init__(self, violations: list[str]):
        super().__init__("; ".join(violations))
        self.violations = violations


def is_identity_element(qname: str) -> bool:
    return bool(IDENTITY_ELEMENT.search(qname.split(":")[-1]))


def violations(bundle: FixRequest) -> list[str]:
    out: list[str] = []
    own = bundle.problem.factKey
    for f in bundle.facts:
        if is_identity_element(f.concept):
            out.append(f"identity element {f.concept}")
        if f.dataType == "textBlock" and f.key != own:
            out.append(f"text block {f.concept} (only the problem's own fact may be sent)")
        for v in (f.value, f.display):
            if v is not None and len(v) > MAX_TEXT:
                out.append(f"text of {f.concept} longer than {MAX_TEXT} characters")
                break
    # the rule comes from the taxonomy's workbook (format examples such as "AAAAA9999A"), never from the filing
    for where, text in _strings(bundle.model_dump(exclude={"problem": {"rule"}})):
        if CIN.search(text):
            out.append(f"a CIN in {where}")
        elif PAN.search(text):
            out.append(f"a PAN in {where}")
    return sorted(set(out))


def ensure_private(bundle: FixRequest) -> None:
    found = violations(bundle)
    if found:
        raise PrivacyError(found)


def _strings(node: Any, path: str = "bundle") -> Iterator[tuple[str, str]]:
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _strings(v, f"{path}[{i}]")
