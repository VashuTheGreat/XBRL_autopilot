"""Dimension engine + hypercube engine (XBRL Dimensions 1.0 semantics as used by MCA).

Explicit/typed dimension checks:
  - axis exists, kind matches
  - member belongs to axis domain and is usable
  - default member never reported (Filing Manual #30)
  - no duplicate axis
  - typed member non-empty
"""

from __future__ import annotations
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union


def check_dimension_syntax(A: Any, dims: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    errors = []
    seen: Set[str] = set()

    for d in dims:
        axis = d.get("axis")
        c = A.concept(axis)
        if not c or c.get("kind") not in ("explicitAxis", "typedAxis"):
            errors.append({"code": "dim.unknownAxis", "msg": f"Unknown axis {axis}"})
            continue

        if axis in seen:
            errors.append({"code": "dim.duplicateAxis", "msg": f"Axis {axis} used more than once"})
        seen.add(axis)

        if c.get("kind") == "typedAxis":
            if "member" in d and d["member"] is not None:
                errors.append({"code": "dim.typedAsExplicit", "msg": f"Typed axis {axis} given an explicit member"})
            elif d.get("typed") is None or str(d.get("typed", "")).strip() == "":
                errors.append({"code": "dim.emptyTyped", "msg": f"Empty typed member for {axis}"})
            continue

        if d.get("typed") is not None:
            errors.append({"code": "dim.explicitAsTyped", "msg": f"Explicit axis {axis} given a typed value"})
            continue

        member = d.get("member")
        m = A.concept(member)
        if not m or m.get("kind") != "member":
            errors.append({"code": "dim.unknownMember", "msg": f"Unknown member {member}"})
            continue

        info = A.axis_info(axis)
        mi = info.get("members", {}).get(member) if info else None
        if not mi:
            errors.append({"code": "dim.memberNotInDomain", "msg": f"{member} is not a member of {axis}"})
        elif not mi.get("usable"):
            errors.append({"code": "dim.memberNotUsable", "msg": f"{member} is not usable on {axis}"})

        if A.dimension_default(axis) == member:
            errors.append(
                {
                    "code": "dim.defaultReported",
                    "msg": f"Default member {member} of {axis} must not appear in the instance",
                }
            )

    return errors


checkDimensionSyntax = check_dimension_syntax


def hc_satisfied(A: Any, hc: Dict[str, Any], dims: List[Dict[str, Any]], closed: bool) -> Dict[str, Any]:
    by_axis = {d["axis"]: d for d in dims}
    hc_axes = {ax["axis"] for ax in hc.get("axes", [])}

    for ax in hc.get("axes", []):
        axis_name = ax["axis"]
        d = by_axis.get(axis_name)
        if not d:
            def_member = None if ax.get("typed") else A.dimension_default(axis_name)
            dm = next((m for m in ax.get("members", []) if m.get("member") == def_member), None)
            if dm and dm.get("usable"):
                continue
            why = (
                f"{axis_name} must be given a member (its total {def_member} is not usable)"
                if dm
                else f"missing {axis_name}"
            )
            return {"ok": False, "why": why}

        if ax.get("typed"):
            if d.get("typed") is None or str(d.get("typed", "")).strip() == "":
                return {"ok": False, "why": f"typed {axis_name} empty"}
            continue

        member = d.get("member")
        m = next((x for x in ax.get("members", []) if x.get("member") == member), None)
        if not m or not m.get("usable"):
            return {"ok": False, "why": f"{member} not valid on {axis_name}"}

    if closed:
        for d in dims:
            if d["axis"] not in hc_axes:
                return {"ok": False, "why": f"extra axis {d['axis']} on closed hypercube"}

    return {"ok": True}


def dimensionally_valid(A: Any, concept: str, dims: List[Dict[str, Any]]) -> Dict[str, Any]:
    base_sets = A.concept_hypercubes(concept)
    if not base_sets:
        if dims:
            return {
                "valid": False,
                "reason": f"{concept} has no hypercube; context must not have dimensions (Filing Manual #35)",
            }
        return {"valid": True, "baseSet": None}

    reasons = []
    for bs in base_sets:
        pos = [h for h in bs.get("hypercubes", []) if h.get("type") == "all"]
        negs = [h for h in bs.get("hypercubes", []) if h.get("type") == "notAll"]
        if not pos:
            reasons.append(f"{bs.get('elr')}: no positive hypercube")
            continue

        ok = True
        for h in pos:
            defn = A.hypercube(h.get("hypercube"), h.get("hcElr"))
            r = hc_satisfied(A, defn, dims, h.get("closed", False))
            if not r["ok"]:
                ok = False
                reasons.append(f"{h.get('hypercube')}: {r['why']}")
                break
        if not ok:
            continue

        excluded = False
        for h in negs:
            defn = A.hypercube(h.get("hypercube"), h.get("hcElr"))
            if hc_satisfied(A, defn, dims, h.get("closed", False))["ok"]:
                excluded = True
                reasons.append(f"excluded by notAll {h.get('hypercube')}")
                break
        if excluded:
            continue

        return {"valid": True, "baseSet": bs.get("elr")}

    return {"valid": False, "reason": "; ".join(reasons) or "no base set accepts this context"}


dimensionallyValid = dimensionally_valid


def unusable_default_axes(A: Any, table_or_id: Any, dims: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    t = A.table(table_or_id) if isinstance(table_or_id, str) else table_or_id
    if not t:
        return []
    given = {d["axis"] for d in (dims or [])}
    out = []
    for ax in t.get("axes", []):
        if not ax.get("typed") and ax.get("axis") not in given and ax.get("default"):
            unusable = any(m.get("member") == ax["default"] and not m.get("usable") for m in ax.get("members", []))
            if unusable:
                valid_members = [
                    m["member"] for m in ax.get("members", []) if m.get("usable") and m.get("member") != ax["default"]
                ]
                out.append({"axis": ax["axis"], "default": ax["default"], "members": valid_members})
    return out


unusableDefaultAxes = unusable_default_axes


def nondim_allowed(A: Any, concept: str) -> bool:
    return dimensionally_valid(A, concept, []).get("valid", False)


nondimAllowed = nondim_allowed


def tables_for_fact(A: Any, fact: Any) -> List[Dict[str, Any]]:
    dims = getattr(fact, "dims", fact.get("dims", []) if isinstance(fact, dict) else [])
    if not dims:
        return []
    concept = getattr(fact, "concept", fact.get("concept") if isinstance(fact, dict) else None)
    cands = []
    for t in A.tables_for_concept(concept):
        axes = {ax["axis"] for ax in t.get("axes", [])}
        if all(d["axis"] in axes for d in dims):
            cands.append(t)
    exact = [t for t in cands if len(t.get("axes", [])) == len(dims)]
    return exact if exact else cands


tablesForFact = tables_for_fact

_SEQ_MEMBER_RE = re.compile(r"^(.*?[A-Za-z_])(\d+)(Member)?$")


def sequential_gaps(values: List[str]) -> List[Dict[str, Any]]:
    groups: Dict[str, Set[int]] = {}
    for v in values:
        m = _SEQ_MEMBER_RE.match(v)
        if not m:
            continue
        k = f"{m.group(1)}|{m.group(3) or ''}"
        groups.setdefault(k, set()).add(int(m.group(2)))

    gaps = []
    for k, nums in groups.items():
        max_num = max(nums)
        prefix = k.split("|")[0]
        for i in range(1, max_num + 1):
            if i not in nums:
                gaps.append({"prefix": prefix, "missing": i, "max": max_num})
    return gaps


sequentialGaps = sequential_gaps


def next_typed_member(existing: List[str], prefix: str) -> str:
    escaped_prefix = re.escape(prefix)
    pattern = re.compile(rf"^{escaped_prefix}(\d+)$")
    max_num = 0
    for v in existing:
        m = pattern.match(v)
        if m:
            max_num = max(max_num, int(m.group(1)))
    return f"{prefix}{max_num + 1}"


nextTypedMember = next_typed_member
