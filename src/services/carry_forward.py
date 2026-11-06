"""Carry-forward engine: carry a dimensional table's previous-year columns and values into CY."""

from __future__ import annotations
import json
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core.views import table_slices, nondim_row_concepts
from src.core.periods import reporting_year
from src.core.model import dim_key
from src.core.dimensions import dimensionally_valid, tables_for_fact, unusable_default_axes


def carry_forward_plan(S: Any, table_id: str) -> Dict[str, Any]:
    A = S.A
    out = {"available": False, "reason": "", "columns": [], "newColumns": [], "values": 0}
    cy = S.table_status(table_id, "CY")
    py = S.table_status(table_id, "PY")
    if not cy.get("applicable"):
        out["reason"] = "The current-year table is not applicable."
        return out
    if not py.get("applicable"):
        out["reason"] = "The previous-year table is not applicable."
        return out

    py_cols = [
        d
        for d in table_slices(A, S.filing, table_id, "PY", reporting_year)
        if not unusable_default_axes(A, table_id, d)
    ]
    if not py_cols:
        out["reason"] = "The previous-year table has no columns."
        return out

    have = {dim_key(d) for d in table_slices(A, S.filing, table_id, "CY", reporting_year)}
    out["available"] = True
    out["columns"] = py_cols
    out["newColumns"] = [d for d in py_cols if dim_key(d) not in have]
    out["values"] = len(value_candidates(S, table_id, py_cols))
    return out


carryForwardPlan = carry_forward_plan


def value_candidates(S: Any, table_id: str, cols: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    A = S.A
    t = A.table(table_id)
    rows = [
        l
        for l in (S.table_view(table_id).get("lineItems") or [])
        if not l.get("abstract") and l.get("preferredLabel") not in ("periodStartLabel", "periodEndLabel")
    ]
    shared = nondim_row_concepts(A)
    res = []
    for dims in cols:
        for l in rows:
            concept = l["concept"]
            pref = l.get("preferredLabel")
            pf = S.get_value(concept, "PY", dims, pref)
            if not pf or pf.nil:
                continue
            if not dims and concept in shared:
                continue
            if S.get_value(concept, "CY", dims, pref):
                continue
            if not dimensionally_valid(A, concept, dims).get("valid") or not S.concept_status(concept, "CY").get("applicable"):
                continue
            if A.is_numeric(concept) and S.calculated_cell(concept, "CY", dims, t.get("presentationElr"), pref):
                continue
            res.append({"dims": dims, "row": l, "fact": pf})
    return res


def carry_forward(S: Any, table_id: str, values: bool = False) -> Dict[str, Any]:
    plan = carry_forward_plan(S, table_id)
    if not plan["available"]:
        raise ValueError(plan["reason"])
    columns = [S.validate_slice(table_id, d) for d in plan["newColumns"]]
    res = {"columns": columns, "values": 0, "skipped": []}
    if not values:
        return res
    for c in value_candidates(S, table_id, plan["columns"]):
        try:
            S.set_table_value(
                table_id,
                "CY",
                c["dims"],
                c["row"]["concept"],
                S.display_of(c["fact"]),
                preferred_label=c["row"].get("preferredLabel"),
                recalc=True,
                lock_calculated=True,
            )
            res["values"] += 1
        except Exception as e:
            res["skipped"].append({"reason": str(e), "concept": c["row"]["concept"]})
    return res


carryForward = carry_forward


def key_of(concept: str, dims: List[Dict[str, Any]], period: Any) -> str:
    return f"{concept}#{dim_key(dims)}#{json.dumps(period, sort_keys=True)}"


def previous_year_values(S: Any) -> Dict[str, Any]:
    f = S.filing
    P = f.meta.get("periods", {})
    out: Dict[str, Any] = {}
    for x in f.all():
        if not x.nil and x.value is not None and f.scope_of(x.period) == "PY":
            out[key_of(x.concept, x.dims, x.period)] = x
    for x in f.set_aside or []:
        if x.get("value") is None or reporting_year(P, x.get("period")) != "PY" or not S.A.concept(x.get("concept")):
            continue
        k = key_of(x["concept"], x.get("dims") or [], x["period"])
        if k not in out:
            out[k] = {"concept": x["concept"], "dims": x.get("dims") or [], "period": x["period"], "value": x["value"], "nil": False}
    for x in (f.import_report or {}).get("notApplicable", []):
        if x.get("value") is None or reporting_year(P, x.get("period")) != "PY" or not S.A.concept(x.get("concept")):
            continue
        k = key_of(x["concept"], x.get("dims") or [], x["period"])
        if k not in out:
            out[k] = {"concept": x["concept"], "dims": x.get("dims") or [], "period": x["period"], "value": x["value"], "nil": False}
    return out


previousYearValues = previous_year_values


def is_disclosure_tab(A: Any, uri: str) -> bool:
    e = A.elr(uri)
    return bool(e and e.get("group") == "Disclosures")


disclosureTab = is_disclosure_tab


def disclosure_carry_plan(S: Any, elr_uri: str, table_id: Optional[str] = None) -> Dict[str, Any]:
    A = S.A
    out = {"available": False, "reason": "", "items": []}
    if not is_disclosure_tab(A, elr_uri):
        out["reason"] = "Not a disclosure tab."
        return out
    if not S.elr_status(elr_uri, "CY").get("applicable"):
        out["reason"] = "This tab is not applicable for the current year."
        return out
    prev = previous_year_values(S)
    if not prev:
        out["reason"] = "No previous-year values: open last year's project moved forward, or import last year's XML as 'Next year's filing'."
        return out

    def display(x: Any) -> str:
        f_mock = type("MockFact", (), {"concept": x["concept"], "value": x["value"], "nil": False})()
        return S.display_of(f_mock)

    def is_empty(x: Any) -> bool:
        return not x or getattr(x, "nil", False)

    if not table_id:
        for r in S.elr_view(elr_uri).get("rows", []):
            if r.get("kind") != "item" or r.get("preferredLabel") == "periodStartLabel":
                continue
            pref = r.get("preferredLabel")
            if not S.cell_status(elr_uri, r["concept"], "CY").get("applicable") or not is_empty(S.get_value(r["concept"], "CY", [], pref)):
                continue
            if A.is_numeric(r["concept"]) and S.calculated_cell(r["concept"], "CY", [], elr_uri, pref):
                continue
            pp = S.period_for_cell(r["concept"], "PY", pref)
            x = prev.get(key_of(r["concept"], [], pp)) if pp else None
            if x:
                out["items"].append({"kind": "row", "concept": r["concept"], "dims": [], "preferredLabel": pref, "display": display(x)})

    tables = [table_id] if table_id else [r["tableId"] for r in S.elr_view(elr_uri).get("rows", []) if r.get("kind") == "table"]
    for tid in tables:
        t = A.table(tid)
        if not t or not S.table_status(tid, "CY").get("applicable"):
            continue
        lines = [l for l in (S.table_view(tid).get("lineItems") or []) if not l.get("abstract") and l.get("preferredLabel") not in ("periodStartLabel", "periodEndLabel")]
        for x in prev.values():
            if x["concept"] not in t.get("lineItems", []):
                continue
            if len(x.get("dims", [])) > 0:
                if not any(y.get("id") == tid for y in tables_for_fact(A, x)):
                    continue
            elif t.get("axes"):
                continue
            matching_line = None
            for li in lines:
                if li["concept"] == x["concept"]:
                    py_per = S.period_for_cell(x["concept"], "PY", li.get("preferredLabel"))
                    if json.dumps(py_per, sort_keys=True) == json.dumps(x["period"], sort_keys=True):
                        matching_line = li
                        break
            if not matching_line or not is_empty(S.get_value(x["concept"], "CY", x.get("dims", []), matching_line.get("preferredLabel"))):
                continue
            if not dimensionally_valid(A, x["concept"], x.get("dims", [])).get("valid") or not S.concept_status(x["concept"], "CY").get("applicable"):
                continue
            try:
                S.validate_slice(tid, x.get("dims", []))
            except Exception:
                continue
            if A.is_numeric(x["concept"]) and S.calculated_cell(x["concept"], "CY", x.get("dims", []), t.get("presentationElr"), matching_line.get("preferredLabel")):
                continue
            out["items"].append({
                "kind": "cell",
                "tableId": tid,
                "concept": x["concept"],
                "dims": x.get("dims", []),
                "preferredLabel": matching_line.get("preferredLabel"),
                "display": display(x),
            })

    out["available"] = True
    if not out["items"]:
        out["reason"] = "Every current-year cell that last year reported is already filled."
    return out


disclosureCarryPlan = disclosure_carry_plan


def disclosure_carry(S: Any, elr_uri: str, table_id: Optional[str] = None) -> Dict[str, Any]:
    A = S.A
    res = {"copied": 0, "skipped": []}

    def is_answer(it: Dict[str, Any]) -> bool:
        return A.data_type(it["concept"]) in ("boolean", "enum")

    tried: Set[str] = set()
    for _ in range(4):
        plan = disclosure_carry_plan(S, elr_uri, table_id=table_id)
        todo = [it for it in plan.get("items", []) if key_of(it["concept"], it.get("dims", []), it.get("preferredLabel")) not in tried]
        if not todo:
            break
        todo.sort(key=is_answer, reverse=True)
        for it in todo:
            k = key_of(it["concept"], it.get("dims", []), it.get("preferredLabel"))
            tried.add(k)
            try:
                if it.get("kind") == "row":
                    S.set_value(it["concept"], "CY", it["display"], preferred_label=it.get("preferredLabel"), tab=elr_uri, recalc=True)
                else:
                    S.set_table_value(it["tableId"], "CY", it.get("dims", []), it["concept"], it["display"], preferred_label=it.get("preferredLabel"), recalc=True, lock_calculated=True)
                res["copied"] += 1
            except Exception as e:
                res["skipped"].append({"concept": it["concept"], "reason": str(e)})

    return res


disclosureCarry = disclosure_carry
