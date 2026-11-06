"""Calculation totals auto-fill for empty total cells of dimensional tables."""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core import decimal as Dec
from src.core.model import dim_key
from src.core.dimensions import dimensionally_valid
from src.core.views import table_slices, total_column_allowed
from src.core.periods import reporting_year
from src.core.scaling import to_display
from .member_hints import additive_axes

SUMMABLE = {"monetary", "shares"}


def axis_default(A: Any, ax: Dict[str, Any]) -> Optional[str]:
    return A.dimension_default(ax["axis"]) or None


def member_of(A: Any, ax: Dict[str, Any], dims: List[Dict[str, Any]]) -> Optional[str]:
    d = next((x for x in dims if x["axis"] == ax["axis"]), None)
    return d.get("member") if d else axis_default(A, ax)


def with_member(A: Any, ax: Dict[str, Any], dims: List[Dict[str, Any]], member: Optional[str]) -> List[Dict[str, Any]]:
    rest = [d for d in dims if d["axis"] != ax["axis"]]
    return rest if (member and member == axis_default(A, ax)) else (rest + [{"axis": ax["axis"], "member": member}] if member else rest)


def depth_of(A: Any, t: Dict[str, Any], dims: List[Dict[str, Any]]) -> int:
    total = 0
    for ax in t.get("axes", []):
        d = 0
        ms = {m["member"]: m for m in ax.get("members", [])}
        cur = member_of(A, ax, dims)
        p = ms.get(cur, {}).get("parent")
        while p:
            d += 1
            p = ms.get(p, {}).get("parent")
        total += d
    return total


def fill_totals_plan(S: Any, table_id: str, scope: str) -> List[Dict[str, Any]]:
    A = S.A
    filing = S.filing
    t = A.table(table_id)
    add = additive_axes(A)
    axes = [ax for ax in t.get("axes", []) if not ax.get("typed") and ax["axis"] in add]
    if not axes or not S.table_status(table_id, scope).get("applicable"):
        return []

    rows = [
        l
        for l in (S.table_view(table_id).get("lineItems") or [])
        if not l.get("abstract") and l.get("preferredLabel") != "periodStartLabel" and A.data_type(l["concept"]) in SUMMABLE
    ]
    cols = table_slices(A, filing, table_id, scope, reporting_year)
    other = "PY" if scope == "CY" else "CY"
    targets = {dim_key(d): d for d in cols}
    if "" not in targets and total_column_allowed(A, table_id) and any(not d for d in table_slices(A, filing, table_id, other, reporting_year)):
        targets[""] = []

    plan = []
    planned: Dict[str, Dec.Dec] = {}

    def value_at(q: str, per: Dict[str, Any], dims: List[Dict[str, Any]]) -> Optional[Dec.Dec]:
        k = f"{q}#{dim_key(dims)}"
        if k in planned:
            return planned[k]
        f = filing.get(q, per, dims)
        return Dec.parse(f.value) if (f and not f.nil) else None

    ordered = sorted(targets.values(), key=lambda d: depth_of(A, t, d), reverse=True)
    for pd in ordered:
        for l in rows:
            q = l["concept"]
            if not (dimensionally_valid(A, q, pd).get("valid") if pd else True) or not S.concept_status(q, scope).get("applicable"):
                continue
            if not pd and not dimensionally_valid(A, q, []).get("valid"):
                continue
            per = S.period_for_cell(q, scope, l.get("preferredLabel"))
            if not per or value_at(q, per, pd) is not None:
                continue
            if S.calculated_cell(q, scope, pd, t.get("presentationElr"), l.get("preferredLabel")):
                continue

            sums = []
            for ax in axes:
                m = member_of(A, ax, pd)
                kids = [with_member(A, ax, pd, x["member"]) for x in ax.get("members", []) if x.get("parent") == m and x.get("usable") is not False]
                vals = [value_at(q, per, kd) for kd in kids if value_at(q, per, kd) is not None]
                if vals:
                    sums.append(Dec.sum_dec(vals))

            if not sums or any(not Dec.eq(x, sums[0]) for x in sums):
                continue
            planned[f"{q}#{dim_key(pd)}"] = sums[0]
            plan.append({"dims": pd, "concept": q, "preferredLabel": l.get("preferredLabel"), "value": Dec.to_string(sums[0])})

    return plan


fillTotalsPlan = fill_totals_plan


def fill_totals(S: Any, table_id: str, scope: str) -> Dict[str, Any]:
    A = S.A
    plan = fill_totals_plan(S, table_id, scope)
    res = {
        "filled": 0,
        "columns": len({dim_key(p["dims"]) for p in plan}),
        "skipped": [],
    }
    t = A.table(table_id)
    for p in plan:
        display = to_display(p["value"], S.filing.meta.get("level", "Actual")) if A.data_type(p["concept"]) == "monetary" else p["value"]
        if S.calculated_cell(p["concept"], scope, p["dims"], t.get("presentationElr"), p.get("preferredLabel")):
            continue
        try:
            S.set_table_value(
                table_id,
                scope,
                p["dims"],
                p["concept"],
                display,
                preferred_label=p.get("preferredLabel"),
                recalc=True,
                lock_calculated=True,
            )
            res["filled"] += 1
        except Exception as e:
            res["skipped"].append({"concept": p["concept"], "reason": str(e)})

    return res


fillTotals = fill_totals
