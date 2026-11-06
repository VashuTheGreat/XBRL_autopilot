"""Mandatory marks helper: determines which cells are mandatory under current filing state."""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core.model import dim_key
from src.core.dimensions import dimensionally_valid
from src.core.periods import reporting_year
from src.engine.expr import eval_pred

_INDEX_CACHE: Dict[int, Dict[str, List[Dict[str, Any]]]] = {}


def index_rules(A: Any) -> Dict[str, List[Dict[str, Any]]]:
    a_id = id(A)
    if a_id in _INDEX_CACHE:
        return _INDEX_CACHE[a_id]
    by: Dict[str, List[Dict[str, Any]]] = {}

    def add(q: Optional[str], r: Dict[str, Any]):
        if q:
            by.setdefault(q, []).append(r)

    for r in A.rules.get("rules", []):
        if r.get("status") != "EXECUTABLE" or not r.get("ast") or r.get("severity") == "WARNING":
            continue
        a = r["ast"]
        a_type = a.get("type")
        if a_type in ("mandatory", "memberMandatory"):
            add(a.get("concept"), r)
        elif a_type == "eachFactOf" and a.get("assert", {}).get("op") == "entered" and a.get("assert", {}).get("e", {}).get("fact"):
            add(a["assert"]["e"]["fact"], r)
        elif a_type in ("iffEntered", "lineItemsMandatory"):
            for q in a.get("concepts", []):
                add(q, r)

    _INDEX_CACHE[a_id] = by
    return by


_SINGLE_MEMBER_CACHE: Dict[int, Set[str]] = {}


def single_member_tables(A: Any) -> Set[str]:
    a_id = id(A)
    if a_id in _SINGLE_MEMBER_CACHE:
        return _SINGLE_MEMBER_CACHE[a_id]
    s: Set[str] = set()
    for r in A.rules.get("rules", []):
        if r.get("status") == "EXECUTABLE" and r.get("ast", {}).get("type") == "lineItemSingleMember":
            for tid in r.get("ast", {}).get("tables", []):
                s.add(tid)
    _SINGLE_MEMBER_CACHE[a_id] = s
    return s


def facts_of(filing: Any, q: str) -> List[Any]:
    return filing.facts_of(q)


def mandatory_cell(
    S: Any,
    concept: str,
    scope: str,
    dims: Optional[List[Dict[str, Any]]] = None,
    table_id: Optional[str] = None,
) -> Dict[str, Any]:
    dims = dims or []
    A = S.A
    filing = S.filing
    out = {"mandatory": False, "rules": [], "conditional": False}
    if scope == "PY" and filing.meta.get("firstFinancialYear"):
        return out

    key = dim_key(dims)
    p_dict = filing.meta.get("periods", {})
    env = lambda extra=None: S.app.env(filing, scope, extra)
    in_scope = lambda f: not f.nil and reporting_year(p_dict, f.period) == scope

    for r in index_rules(A).get(concept, []):
        if r.get("scope", {}).get("periods") and scope not in r["scope"]["periods"]:
            continue
        a = r.get("ast", {})
        hit = False
        cond = False
        a_type = a.get("type")

        if a_type == "mandatory":
            if not dims:
                if not a.get("when"):
                    hit = True
                else:
                    cond = a["when"].get("op") != "reportType"
                    hit = eval_pred(a["when"], env()) is True
        elif a_type == "eachFactOf":
            cond = True
            for f in facts_of(filing, a.get("concept", "")):
                if not in_scope(f):
                    continue
                if a.get("when") and eval_pred(a["when"], env({"self": f, "dims": f.dims})) is not True:
                    continue
                target = f.dims if dimensionally_valid(A, concept, f.dims).get("valid") else []
                if dim_key(target) == key:
                    hit = True
                    break
        elif a_type == "iffEntered":
            cond = True
            other = next((q for q in a.get("concepts", []) if q != concept), None)
            if other:
                hit = any(in_scope(f) and dim_key(f.dims) == key for f in facts_of(filing, other))
        elif a_type == "lineItemsMandatory":
            hit = len(dims) > 0 and (not table_id or table_id in a.get("tables", [])) and bool(dimensionally_valid(A, concept, dims).get("valid"))
            if hit and any(tid in single_member_tables(A) for tid in a.get("tables", [])) and not any(in_scope(f) and dim_key(f.dims) == key for f in facts_of(filing, concept)):
                axes = {x["axis"] for tid in a.get("tables", []) if A.table(tid) for x in A.table(tid).get("axes", [])}
                if any(in_scope(f) and f.dims and all(d["axis"] in axes for d in f.dims) for f in facts_of(filing, concept)):
                    hit = False
        elif a_type == "memberMandatory":
            cond = True
            hit = any(d.get("member") == a.get("member") for d in dims) and bool(dimensionally_valid(A, concept, dims).get("valid"))

        if hit:
            out["mandatory"] = True
            out["rules"].append(r["id"])
            if cond:
                out["conditional"] = True

    return out


mandatoryCell = mandatory_cell
