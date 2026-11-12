"""Exemption sheets consumed by the generic rules: exempt parent / child members (parent-member rule) and
parent-child calculation exemptions (calculation rule)."""
from __future__ import annotations

from src.services.engine_rules.jsre import ji, js
from src.services.engine_rules.resolver import Resolver, norm

_NAME = js(r"[A-Z]\w{5,}")


def resolve_exempt(sheet: dict | None, R: Resolver) -> list[dict]:
    out = []
    for r in (sheet or {}).get("rows", []):
        x = {"table": r["table"], "axis": R.concept(r["axis"]), "member": R.concept(r["member"]), "line": r["line"]}
        if x["axis"] and x["member"]:
            out.append(x)
    return out


def data_status(si: int, r: dict, R: Resolver, consumer: str, dts: str) -> dict:
    if si > 0:
        return {"status": "NOT_APPLICABLE", "reason": "Legacy duplicate sheet; the primary sheet is consumed"}
    if not R.concept(r["axis"]) or not R.concept(r["member"]):
        return {"status": "NOT_APPLICABLE", "reason": f"Axis/member not present in the {dts} DTS"}
    return {"status": "EXECUTABLE", "implementation": f"data:{consumer} exemption list"}


def resolve_pc_exempt(sheet: dict | None, R: Resolver, A: dict) -> list[dict]:
    out = []
    for r in (sheet or {}).get("rows", []):
        abstract = R.concept(r["abstract"])
        mode, concepts = "all", []
        m = ji(r"All (?:child )?elements are exempt except (.+)$").search(r["text"])
        if m:
            mode, concepts = "except", [q for q in (R.concept(t) for t in _NAME.findall(m.group(1))) if q]
        f = ji(r"Following child elements are exempt:\s*(.+)$").search(r["text"])
        if f:
            mode, concepts = "listed", [q for q in (R.concept(t) for t in _NAME.findall(f.group(1))) if q]
        elr = None
        if not abstract:
            hit = next((e for e in A["elrs"] if norm(e["title"]) == norm(r["abstract"])), None)
            elr = (hit or {}).get("uri") or None
        out.append({"abstract": abstract, "elr": elr, "mode": mode, "concepts": concepts, "line": r["line"], "text": r["text"]})
    return out
