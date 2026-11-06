"""Member hints: parent/child (total/part) guidance for dimensional table columns."""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core import decimal as Dec
from src.core.model import dim_key, fact_key
from src.core.dimensions import dimensionally_valid
from src.engine.rules import gr3_required_parent
from src.core.views import table_slices
from src.core.periods import reporting_year

_ADDITIVE_CACHE: Dict[int, Dict[str, List[str]]] = {}


def additive_axes(A: Any) -> Dict[str, List[str]]:
    a_id = id(A)
    if a_id in _ADDITIVE_CACHE:
        return _ADDITIVE_CACHE[a_id]
    m: Dict[str, Set[str]] = {}

    def walk(x: Any, r_id: str):
        if not x:
            return
        if isinstance(x, list):
            for y in x:
                walk(y, r_id)
            return
        if isinstance(x, dict):
            if "sumAxis" in x and isinstance(x["sumAxis"], dict) and isinstance(x["sumAxis"].get("axis"), str):
                m.setdefault(x["sumAxis"]["axis"], set()).add(r_id)
            for v in x.values():
                walk(v, r_id)

    for r in A.rules.get("rules", []):
        if r.get("status") == "EXECUTABLE":
            walk(r.get("ast"), r.get("id"))

    out = {k: sorted(v) for k, v in m.items()}
    _ADDITIVE_CACHE[a_id] = out
    return out


additiveAxes = additive_axes

SUMMABLE = {"monetary", "shares"}


def axis_default(A: Any, ax: Dict[str, Any]) -> Optional[str]:
    return A.dimension_default(ax["axis"]) or next((m["member"] for m in ax.get("members", []) if m.get("depth") == 0), None)


def member_of(A: Any, ax: Dict[str, Any], dims: List[Dict[str, Any]]) -> Optional[str]:
    d = next((x for x in dims if x["axis"] == ax["axis"]), None)
    return d.get("member") if d else axis_default(A, ax)


def with_member(A: Any, ax: Dict[str, Any], dims: List[Dict[str, Any]], member: str) -> List[Dict[str, Any]]:
    rest = [d for d in dims if d["axis"] != ax["axis"]]
    return rest if member == axis_default(A, ax) else rest + [{"axis": ax["axis"], "member": member}]


def member_info(A: Any, ax: Dict[str, Any], member: str) -> Dict[str, Any]:
    members = ax.get("members", [])
    by_m = {m["member"]: m for m in members}
    path = []
    p = by_m.get(member, {}).get("parent")
    while p:
        path.append(p)
        p = by_m.get(p, {}).get("parent")
    children = [m["member"] for m in members if m.get("parent") == member]
    is_default = member == axis_default(A, ax)
    return {"path": path, "parent": by_m.get(member, {}).get("parent"), "children": children, "isTotal": len(children) > 0, "isDefault": is_default}


memberInfo = member_info


def sort_slices(A: Any, table_id: str, slices: List[List[Dict[str, Any]]]) -> List[List[Dict[str, Any]]]:
    t = A.table(table_id)
    pos = [{m["member"]: i for i, m in enumerate(ax.get("members", []))} for ax in t.get("axes", [])]

    def key_fn(dims: List[Dict[str, Any]]) -> List[int]:
        res = []
        for i, ax in enumerate(t.get("axes", [])):
            if ax.get("typed"):
                res.append(-1)
            else:
                mem = member_of(A, ax, dims)
                res.append(pos[i].get(mem, 1_000_000))
        return res

    indexed = [{"dims": dims, "i": i, "k": key_fn(dims)} for i, dims in enumerate(slices)]
    indexed.sort(key=lambda x: (x["k"], x["i"]))
    return [x["dims"] for x in indexed]


sortSlices = sort_slices


def missing_parents(A: Any, table_id: str, slices: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    t = A.table(table_id)
    tnames = [t["hypercube"].split(":")[1]]
    have = {dim_key(d) for d in slices}
    out = []
    for si, dims in enumerate(slices):
        for d in dims:
            if not d.get("member"):
                continue
            ax = next((a for a in t.get("axes", []) if a["axis"] == d["axis"]), None)
            if not ax:
                continue
            chain = []
            cur = dims
            m = d["member"]
            p = gr3_required_parent(A, d["axis"], m, tnames)
            while p:
                pd = with_member(A, ax, cur, p)
                if not any(dimensionally_valid(A, q, pd).get("valid") for q in t.get("lineItems", [])):
                    break
                if dim_key(pd) in have:
                    break
                chain.append({"member": p, "dims": pd})
                cur = pd
                m = p
                p = gr3_required_parent(A, d["axis"], m, tnames)
            if chain:
                out.append({"slice": si, "axis": d["axis"], "child": d["member"], "parents": chain})
    return out


missingParents = missing_parents


def totals_hints(
    S: Any,
    table_id: str,
    scope: str,
    slices: List[List[Dict[str, Any]]],
    include_matches: bool = False,
) -> List[Dict[str, Any]]:
    A = S.A
    filing = S.filing
    t = A.table(table_id)
    add = additive_axes(A)
    axes = [ax for ax in t.get("axes", []) if not ax.get("typed") and ax["axis"] in add]
    if not axes or not slices:
        return []
    have = {dim_key(d): d for d in slices}
    rows = [l for l in (S.table_view(table_id).get("lineItems") or []) if not l.get("abstract") and A.data_type(l["concept"]) in SUMMABLE]
    out = []

    for P in slices:
        for ax in axes:
            pm = member_of(A, ax, P)
            kids = [m["member"] for m in ax.get("members", []) if m.get("parent") == pm]
            kid_cols = [{"member": k, "dims": with_member(A, ax, P, k)} for k in kids if dim_key(with_member(A, ax, P, k)) in have]
            if not kid_cols:
                continue
            for l in rows:
                per = S.period_for_cell(l["concept"], scope, l.get("preferredLabel"))
                if not per:
                    continue
                pf = filing.get(l["concept"], per, P)
                if not pf or pf.nil:
                    continue
                kf = [{"member": k["member"], "dims": k["dims"], "fact": filing.get(l["concept"], per, k["dims"])} for k in kid_cols]
                kf = [k for k in kf if k["fact"] and not k["fact"].nil]
                if not kf:
                    continue
                decs = [
                    int(f.decimals)
                    for f in ([pf] + [k["fact"] for k in kf])
                    if f.decimals not in (None, "INF")
                ]
                d = min(decs) if decs else None
                kid_vals = [Dec.parse(k["fact"].value) for k in kf]
                sum_val = Dec.sum_dec(kid_vals)
                pv = Dec.parse(pf.value)
                a = pv if d is None else Dec.round_dec(pv, d)
                b = sum_val if d is None else Dec.round_dec(sum_val, d)
                ok = Dec.eq(a, b)
                if ok and not include_matches:
                    continue
                out.append({
                    "ok": ok,
                    "tableId": table_id,
                    "scope": scope,
                    "concept": l["concept"],
                    "preferredLabel": l.get("preferredLabel"),
                    "axis": ax["axis"],
                    "parentMember": pm,
                    "parentDims": P,
                    "children": [{"member": k["member"], "dims": k["dims"], "value": k["fact"].value} for k in kf],
                    "missingChildren": [k for k in kids if not any(x["member"] == k for x in kf)],
                    "parentValue": pf.value,
                    "childrenSum": Dec.to_string(sum_val),
                    "difference": Dec.to_string(Dec.sub(pv, sum_val)),
                    "decimals": d,
                    "cellId": fact_key(l["concept"], per, P),
                    "rules": add.get(ax["axis"], []),
                })
    return out


totalsHints = totals_hints


def all_totals_hints(S: Any) -> List[Dict[str, Any]]:
    A = S.A
    add = additive_axes(A)
    out = []
    for t in A.tables:
        if not any(not ax.get("typed") and ax["axis"] in add for ax in t.get("axes", [])):
            continue
        for scope in ("CY", "PY"):
            if not S.table_status(t["id"], scope).get("applicable"):
                continue
            slices = table_slices(A, S.filing, t["id"], scope, reporting_year)
            if slices:
                out.extend(totals_hints(S, t["id"], scope, slices))
    return out


allTotalsHints = all_totals_hints
