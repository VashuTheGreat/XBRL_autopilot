"""Master-data form fields from the knowledge base (docs/17): the mandatory company and auditor items.

Nothing is hardcoded: the fields are the non-abstract, non-table concepts the MCA rules mark mandatory for the
general-information and auditor ELRs. `/indas/generateXML` checks the same `mandatoryByELR` list.
"""
from __future__ import annotations

from typing import Any

COMPANY_ELR = "700300"  # general information about the financial statements
AUDITOR_ELR = "700400"  # auditor's report


def _field(kb: dict[str, Any], qname: str) -> dict[str, Any] | None:
    c = kb.get("concepts", {}).get(qname)
    if not c or c.get("abstract") or qname.endswith("Table") or qname.endswith("Abstract"):
        return None
    return {
        "qname": qname,
        "label": (c.get("labels") or {}).get("label") or c.get("name") or qname,
        "type": c.get("type") or "stringItemType",
    }


def master_fields(kb: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    by_elr = kb.get("businessRules", {}).get("mandatoryByELR", {})

    def fields(elr: str) -> list[dict[str, Any]]:
        out = (_field(kb, q) for q in by_elr.get(elr, []))
        return [f for f in out if f]

    return {"company": fields(COMPANY_ELR), "auditor": fields(AUDITOR_ELR)}
