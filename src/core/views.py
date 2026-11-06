"""UI/table engine model: builds statement and table view-models purely from the authority.

No table-specific code — every table is rendered from ELR → hypercube → axes → members → line items.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple
from .dimensions import nondim_allowed, tables_for_fact


def build_elr_view(A: Any, elr_uri: str) -> Dict[str, Any]:
    elr = A.elr(elr_uri)
    tables = A.tables_in_elr(elr_uri)

    table_by_primary: Dict[str, List[Any]] = {}
    sorted_tables = sorted(
        tables,
        key=lambda t: (-(len(t.get("axes", [])) > 0), t.get("id", "")),
    )
    for t in sorted_tables:
        prim = t.get("primaryItem")
        table_by_primary.setdefault(prim, []).append(t)

    rows: List[Dict[str, Any]] = []
    placed: Set[str] = set()
    skip: Set[str] = set()
    for t in tables:
        skip.add(t.get("hypercube"))
        for n in t.get("lineItemNodes", []):
            skip.add(n)

    def visit(q: str, depth: int, preferred_label: Optional[str]):
        c = A.concept(q)
        if not c or q in skip:
            return
        ts = table_by_primary.get(q, [])
        kind = c.get("kind")
        if kind == "abstract":
            rows.append({"kind": "header", "concept": q, "depth": depth, "label": A.label(q)})
        elif kind == "item":
            if nondim_allowed(A, q):
                rows.append(
                    {
                        "kind": "item",
                        "concept": q,
                        "depth": depth,
                        "label": A.label(q, preferred_label or "label"),
                        "preferredLabel": preferred_label or None,
                        "periodType": c.get("periodType"),
                        "dataType": A.data_type(q),
                    }
                )
        else:
            return

        for t in ts:
            t_id = t.get("id")
            if t_id not in placed:
                suffix = "" if len(t.get("axes", [])) else " — totals"
                rows.append(
                    {
                        "kind": "table",
                        "tableId": t_id,
                        "depth": depth + 1,
                        "label": A.label(t.get("hypercube")) + suffix,
                    }
                )
                placed.add(t_id)

        for arc in A.presentation_children(elr_uri, q):
            target = arc.get("to")
            if any(target in t.get("lineItems", []) or target in t.get("lineItemNodes", []) for t in ts):
                continue
            visit(target, depth + 1, arc.get("preferredLabel"))

    for r in elr.get("roots", []) if elr else []:
        visit(r, 0, None)

    for t in tables:
        t_id = t.get("id")
        if t_id not in placed:
            suffix = "" if len(t.get("axes", [])) else " — totals"
            rows.append(
                {
                    "kind": "table",
                    "tableId": t_id,
                    "depth": 0,
                    "label": A.label(t.get("hypercube")) + suffix,
                }
            )

    return {"elr": elr, "rows": rows, "tables": [t.get("id") for t in tables]}


buildElrView = build_elr_view


def ordered_members(A: Any, table: Dict[str, Any], axis_def: Dict[str, Any]) -> List[Dict[str, Any]]:
    by_member = {m["member"]: m for m in axis_def.get("members", [])}
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    pres = table.get("presentationElr")

    def walk(q: str, depth: int):
        for arc in A.presentation_children(pres, q):
            target = arc.get("to")
            m = by_member.get(target)
            if m and target not in seen:
                seen.add(target)
                out.append(dict(m, depth=depth))
            walk(target, depth + 1)

    if pres:
        walk(axis_def.get("axis"), 0)

    for m in axis_def.get("members", []):
        if m.get("member") not in seen:
            out.append(m)
    return out


def build_table_view(A: Any, table_id: str) -> Dict[str, Any]:
    t = A.table(table_id)
    if not t:
        raise ValueError(f"Unknown table {table_id}")

    axes = []
    for ax in t.get("axes", []):
        is_typed = bool(ax.get("typed"))
        def_member = None if is_typed else A.dimension_default(ax.get("axis"))
        members = []
        if not is_typed:
            for m in ordered_members(A, t, ax):
                members.append(
                    {
                        "member": m.get("member"),
                        "label": A.label(m.get("member")),
                        "depth": m.get("depth", 0),
                        "usable": m.get("usable", False),
                        "isDefault": def_member == m.get("member"),
                    }
                )
        axes.append(
            {
                "axis": ax.get("axis"),
                "label": A.label(ax.get("axis")),
                "typed": is_typed,
                "typedDomain": ax.get("typedDomain"),
                "default": def_member,
                "members": members,
            }
        )

    items: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    seen_concepts: Set[str] = set()
    pres = t.get("presentationElr")
    line_set = {n["concept"] for n in t.get("lineItemTree", [])}

    def walk(q: str, depth: int, preferred_label: Optional[str]):
        for arc in A.presentation_children(pres, q):
            target = arc.get("to")
            pref = arc.get("preferredLabel")
            rk = f"{target}|{pref or ''}"
            if target not in line_set or rk in seen:
                continue
            seen.add(rk)
            seen_concepts.add(target)
            c = A.concept(target)
            is_abs = c.get("abstract", False) if c else False
            items.append(
                {
                    "concept": target,
                    "depth": depth,
                    "abstract": is_abs,
                    "label": A.label(target, pref or "label"),
                    "preferredLabel": pref or None,
                    "periodType": c.get("periodType") if c else None,
                    "dataType": None if is_abs else A.data_type(target),
                    "enumerations": A.enumerations(target),
                }
            )
            walk(target, depth + 1, pref)

    if pres:
        walk(t.get("primaryItem"), 0, None)
        for n in t.get("lineItemNodes", []):
            walk(n, 1, None)

    for n in t.get("lineItemTree", []):
        c_name = n.get("concept")
        if c_name not in seen_concepts:
            c = A.concept(c_name)
            is_abs = c.get("abstract", False) if c else False
            items.append(
                {
                    "concept": c_name,
                    "depth": n.get("depth", 0),
                    "abstract": is_abs,
                    "label": A.label(c_name),
                    "preferredLabel": None,
                    "periodType": c.get("periodType") if c else None,
                    "dataType": None if is_abs else A.data_type(c_name),
                    "enumerations": A.enumerations(c_name),
                }
            )

    return {
        "id": t.get("id"),
        "elr": t.get("elr"),
        "code": t.get("code"),
        "presentationElr": t.get("presentationElr"),
        "hypercube": t.get("hypercube"),
        "primaryItem": t.get("primaryItem"),
        "title": A.label(t.get("hypercube")),
        "closed": t.get("closed", False),
        "axes": axes,
        "lineItems": items,
        "notAll": [{"hypercube": n.get("hypercube"), "appliesTo": n.get("appliesTo")} for n in t.get("notAll", [])],
    }


buildTableView = build_table_view

_TOTAL_COL_CACHE: Dict[Tuple[int, str], bool] = {}


def total_column_allowed(A: Any, table_id: str) -> bool:
    cache_key = (id(A), table_id)
    if cache_key in _TOTAL_COL_CACHE:
        return _TOTAL_COL_CACHE[cache_key]
    t = A.table(table_id)
    ok = (
        bool(t)
        and len(t.get("axes", [])) > 0
        and all(not ax.get("typed") and A.dimension_default(ax.get("axis")) for ax in t.get("axes", []))
        and any(
            not A.concept(q).get("abstract") and nondim_allowed(A, q)
            for q in t.get("lineItems", [])
            if A.concept(q)
        )
    )
    _TOTAL_COL_CACHE[cache_key] = ok
    return ok


totalColumnAllowed = total_column_allowed

_NONDIM_ROWS_CACHE: Dict[int, Dict[str, Set[str]]] = {}


def nondim_row_elrs(A: Any) -> Dict[str, Set[str]]:
    a_id = id(A)
    if a_id in _NONDIM_ROWS_CACHE:
        return _NONDIM_ROWS_CACHE[a_id]
    m: Dict[str, Set[str]] = {}
    for e in A.elrs:
        view = build_elr_view(A, e.get("uri"))
        for r in view.get("rows", []):
            if r.get("kind") == "item":
                m.setdefault(r["concept"], set()).add(e.get("uri"))
    for t in A.tables:
        if not t.get("axes"):
            for q in t.get("lineItems", []):
                m.setdefault(q, set()).add(t.get("presentationElr"))
    _NONDIM_ROWS_CACHE[a_id] = m
    return m


nondimRowElrs = nondim_row_elrs


def nondim_row_concepts(A: Any) -> Set[str]:
    return set(nondim_row_elrs(A).keys())


nondimRowConcepts = nondim_row_concepts


def table_slices(A: Any, filing: Any, table_id: str, scope_year: str, reporting_year_fn: Any) -> List[List[Dict[str, Any]]]:
    t = A.table(table_id)
    if not t:
        return []
    items = set(t.get("lineItems", []))
    axes = {a["axis"] for a in t.get("axes", [])}
    total = total_column_allowed(A, table_id)
    m: Dict[str, List[Dict[str, Any]]] = {}
    has_total = False

    for f in filing.all():
        if f.concept not in items or not all(d["axis"] in axes for d in f.dims):
            continue
        if not f.dims and (not total or has_total or not nondim_allowed(A, f.concept)):
            continue
        if reporting_year_fn(filing.meta.get("periods", {}), f.period) != scope_year:
            continue
        if not f.dims:
            has_total = True
            continue
        if not any(x.get("id") == table_id for x in tables_for_fact(A, f)):
            continue
        k = "|".join(f"{d['axis']}={d.get('member') or d.get('typed')}" for d in f.dims)
        if k not in m:
            m[k] = f.dims

    res = list(m.values())
    return [[]] + res if has_total else res


tableSlices = table_slices
