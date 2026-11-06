"""Filing health check, maintenance, set-aside storage, and comparison with filed figures."""

from __future__ import annotations
import datetime
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from src.core import decimal as Dec
from src.core.dimensions import tables_for_fact
from src.core.model import norm_dims
from src.core.periods import scope_of
from src.core.views import total_column_allowed
from src.engine.gate import Gate
from .importer import import_instance

SET_ASIDE_REASONS = {
    "yearBeforeLast": "Last year's previous-year figure (not part of this filing)",
    "openingBeforeLast": "Last year's previous-year opening balance (not part of this filing)",
    "notApplicablePreviousYear": "Last year's value of an element that is reported for the current year only (disclosures, GR-12)",
    "otherDate": "Dated outside this filing's two years",
    "openingNoCell": "Previous-year opening value that no tab shows (its totals cannot be entered for that date)",
}


def unshown_facts(S: Any) -> List[Dict[str, Any]]:
    g = Gate(S.A)
    f = S.filing
    out = []
    pyo = [x for x in f.all() if f.scope_of(x.period) == "PYO"]
    shown = {
        x.key
        for x in pyo
        if x.origin == "calculated" or g._opening_cell(f, x.concept, x.period, x.dims)
    }

    needed: Set[str] = set()

    def up(x: Any, depth: int = 0):
        if depth > 30:
            return
        for p in S.calc_parents_of(x.concept, x.period, x.dims):
            px = f.get(p, x.period, x.dims)
            if px and px.key not in needed:
                needed.add(px.key)
                up(px, depth + 1)

    for x in pyo:
        if x.key in shown:
            up(x)

    for x in f.all():
        sc = f.scope_of(x.period)
        if sc == "OTHER":
            out.append({"fact": x, "reason": "otherDate"})
        elif sc == "PYO" and x.key not in shown and x.key not in needed:
            out.append({"fact": x, "reason": "openingNoCell"})

    return out


unshownFacts = unshown_facts


def set_aside(S: Any, items: List[Dict[str, Any]], source: str = "health check") -> List[Dict[str, Any]]:
    if not items:
        return []
    at_date = datetime.date.today().isoformat()
    list_items = [
        {
            "concept": i["fact"].concept,
            "period": i["fact"].period,
            "dims": i["fact"].dims,
            "value": None if i["fact"].nil else i["fact"].value,
            "nil": bool(i["fact"].nil),
            "decimals": i["fact"].decimals,
            "unit": i["fact"].unit,
            "lang": i["fact"].lang,
            "reason": i["reason"],
            "source": source,
            "at": at_date,
        }
        for i in items
    ]
    S.remove_facts([i["fact"] for i in items])
    S.filing.set_aside.extend(list_items)
    S.filing.revision += 1
    return list_items


setAside = set_aside


def health_check(S: Any, move: bool = True) -> Dict[str, Any]:
    lists = []
    for f in S.filing.all():
        if f.nil or not isinstance(f.value, str) or 'class="noteText2"' not in f.value or S.A.data_type(f.concept) != "textBlock":
            continue
        v = f.value.replace('<div class="noteText2"><p>•', '<div class="noteText1"><p>•')
        if v != f.value:
            lists.append({"concept": f.concept, "period": f.period, "dims": f.dims})
            f.value = v
            S.filing.revision += 1

    schema_ref = None
    sref = S.filing.meta.get("schemaRef")
    accepted_refs = [x.get("href") for x in (S.A.meta.get("acceptedSchemaRefs") or [{"href": S.A.meta.get("schemaRef")}])]
    if sref and sref not in accepted_refs:
        schema_ref = {"before": sref, "after": S.A.meta.get("schemaRef")}
        S.filing.meta["schemaRef"] = None
        S.filing.revision += 1

    statements = S.refresh_derived_statements()
    cells = S.refresh_calculated_cells()
    moved = set_aside(S, unshown_facts(S)) if move else []

    return {
        "statements": statements,
        "cells": cells,
        "moved": moved,
        "lists": lists,
        "schemaRef": schema_ref,
        "changed": len(statements) + len(cells) + len(moved) + len(lists) + (1 if schema_ref else 0),
    }


healthCheck = health_check


def hidden_data(S: Any) -> Dict[str, Any]:
    f = S.filing
    not_applicable = [
        {"fact": x["fact"], "reasons": x.get("reasons", [])}
        for x in S.app.plan_facts(f).get("excluded", [])
    ]
    return {
        "setAside": [{**x, "index": i} for i, x in enumerate(f.set_aside)],
        "notApplicable": not_applicable,
        "unshown": unshown_facts(S),
    }


hiddenData = hidden_data


def hidden_count(S: Any) -> int:
    h = hidden_data(S)
    return len(h["setAside"]) + len(h["notApplicable"]) + len(h["unshown"])


hiddenCount = hidden_count


def cell_for(S: Any, x: Dict[str, Any]) -> Dict[str, Any]:
    A = S.A
    f = S.filing
    g = Gate(A)
    sc = scope_of(f.meta.get("periods", {}), x.get("period"))
    dims = norm_dims(x.get("dims") or [])
    if not A.concept(x.get("concept")):
        return {"why": "element unknown to the taxonomy"}
    if sc == "OTHER" or not sc:
        return {"why": "dated outside this filing's years"}
    if sc == "PYO":
        loc = g._opening_cell(f, x["concept"], x["period"], dims)
        return (
            {"kind": "cell" if loc.get("tableId") else "row", "scope": "PY", "elrUri": loc.get("elrUri"), "tableId": loc.get("tableId"), "dims": dims, "preferredLabel": "periodStartLabel"}
            if loc
            else {"why": "no tab shows a cell for this date"}
        )

    def pl_ok(pl: Optional[str]) -> bool:
        return S.period_for_cell(x["concept"], sc, pl) == x.get("period")

    if not dims:
        for e in A.elrs:
            r = next((y for y in S.elr_view(e["uri"]).get("rows", []) if y.get("kind") == "item" and y.get("concept") == x["concept"] and pl_ok(y.get("preferredLabel"))), None)
            if r and S.cell_status(e["uri"], x["concept"], sc).get("applicable"):
                return {"kind": "row", "scope": sc, "elrUri": e["uri"], "dims": [], "preferredLabel": r.get("preferredLabel")}

    ts = (
        tables_for_fact(A, {"concept": x["concept"], "dims": dims})
        if dims
        else [t for t in A.tables if x["concept"] in t.get("lineItems", []) and total_column_allowed(A, t.get("id"))]
    )
    for t in ts:
        if not S.table_status(t["id"], sc).get("applicable"):
            continue
        try:
            S.validate_slice(t["id"], dims)
        except Exception:
            continue
        e = A.elr(t.get("presentationElr"))
        line = next((l for l in S.table_view(t["id"]).get("lineItems", []) if l.get("concept") == x["concept"] and pl_ok(l.get("preferredLabel"))), None)
        if line and S.concept_status(x["concept"], sc).get("applicable"):
            return {
                "kind": "cell",
                "scope": sc,
                "elrUri": t.get("presentationElr"),
                "tabId": e.get("code") if e else None,
                "tableId": t["id"],
                "dims": dims,
                "preferredLabel": line.get("preferredLabel"),
            }

    return {"why": "the cell belongs to a table or disclosure that is not applicable"}


cellFor = cell_for


def restore_target(S: Any, x: Dict[str, Any]) -> Dict[str, Any]:
    if S.filing.get(x["concept"], x["period"], norm_dims(x.get("dims") or [])):
        return {"why": "the cell already has a value"}
    return cell_for(S, x)


restoreTarget = restore_target


def restore_fact(S: Any, index: int) -> Dict[str, Any]:
    items = S.filing.set_aside
    if index < 0 or index >= len(items):
        raise ValueError("Invalid set-aside index")
    x = items[index]
    target = restore_target(S, x)
    if "why" in target:
        raise ValueError(target["why"])
    display = S.display_of(type("FactMock", (), {"concept": x["concept"], "value": x["value"], "nil": x["nil"]})())
    if target["kind"] == "row":
        fact = S.set_value(x["concept"], target["scope"], display, preferred_label=target.get("preferredLabel"), tab=target.get("elrUri"), recalc=True)
    else:
        fact = S.set_table_value(target["tableId"], target["scope"], target["dims"], x["concept"], display, preferred_label=target.get("preferredLabel"), recalc=True, lock_calculated=True)
    items.pop(index)
    S.filing.revision += 1
    return {"fact": fact, "target": target}


restoreFact = restore_fact


def delete_set_aside(S: Any, index: int) -> Dict[str, Any]:
    items = S.filing.set_aside
    if index < 0 or index >= len(items):
        raise ValueError("Invalid set-aside index")
    removed = items.pop(index)
    S.filing.revision += 1
    return removed


deleteSetAside = delete_set_aside


def compare_with_filed(S: Any, xml_text: str) -> Dict[str, Any]:
    res = import_instance(S.A, xml_text, year_mode="current", file_name="filed.xml")
    filed = res["filing"]
    f = S.filing
    differences = []

    for filed_fact in filed.all():
        if filed_fact.nil:
            continue
        cur = f.get(filed_fact.concept, filed_fact.period, filed_fact.dims)
        cur_val = cur.value if cur and not cur.nil else None
        if cur_val != filed_fact.value:
            differences.append({
                "concept": filed_fact.concept,
                "period": filed_fact.period,
                "dims": filed_fact.dims,
                "filed": filed_fact.value,
                "current": cur_val,
            })

    return {
        "compared": len(filed.all()),
        "differences": differences,
        "match": len(differences) == 0,
    }


compareWithFiled = compare_with_filed
