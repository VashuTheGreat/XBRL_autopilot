"""One-click remedies for validation messages with unambiguous solutions."""

from __future__ import annotations
import re
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from src.core import decimal as Dec
from src.core.derived import statement_note_links
from src.core.dimensions import unusable_default_axes
from src.core.periods import reporting_year
from src.core.scaling import SCALE_POWERS, to_display
from .upkeep import cell_for, set_aside
from .pdf_preview import group_in

PL = {"CY": "current year", "PY": "previous year"}


def esc(x: Any) -> str:
    return (
        str(x if x is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def fix_for(S: Any, issue: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not issue:
        return None
    code = issue.get("code")
    if code == "shareCapital.rounded":
        return share_capital_fix(S, issue)
    if issue.get("severity") != "ERROR":
        return None

    A = S.A
    f = S.filing
    fact = f.facts.get(issue["factKey"]) if issue.get("factKey") else None

    if code == "schemaRef":
        def apply_schema():
            f.meta["schemaRef"] = None
            f.revision += 1

        return {
            "label": "Use the V3 schema reference",
            "confirm": f"Write the XML with the schema reference the MCA XBRL Validator requires: <b>{esc(A.meta.get('schemaRef'))}</b> (instead of {esc(f.meta.get('schemaRef') or '')}).",
            "apply": apply_schema,
        }

    if code == "dim.hypercube" and fact:
        x = column_total_fix(S, fact)
        if x:
            return x

    rule = next((r for r in A.rules.get("rules", []) if r.get("id") == issue.get("ruleId")), None)
    if rule and rule.get("ast", {}).get("type") == "lineItemSingleMember" and issue.get("concept") and issue.get("tableId"):
        return single_member_fix(S, issue)

    msg = issue.get("message") or ""
    scope_of_fact = lambda x: reporting_year(f.meta.get("periods", {}), x.period)
    locked = lambda sc: S.py_locked(sc)

    loc = issue.get("location")
    if loc and loc.get("kind") == "pyo" and fact:
        other = f.scope_of(fact.period) == "OTHER"
        return {
            "label": "Set it aside",
            "confirm": f"Set aside <b>{esc(A.label(fact.concept))}</b>? It stays in the project under Hidden data.",
            "apply": lambda: set_aside(S, [{"fact": fact, "reason": "otherDate" if other else "openingNoCell"}], "fix"),
        }

    if issue.get("ruleId") == "GR-1" and fact and "is entered but its calculation parent" in msg:
        if f.scope_of(fact.period) == "PYO":
            return {
                "label": "Remove this opening value",
                "confirm": f"Remove the previous-year opening value <b>{esc(A.label(fact.concept))}</b>? Its total has no cell for that date.",
                "apply": lambda: S.remove_facts([fact]),
            }
        sc = scope_of_fact(fact)
        for p in S.calc_parents_of(fact.concept, fact.period, fact.dims):
            t = S.total_from_parts(p, fact.period, fact.dims)
            if not t:
                continue
            if locked(sc):
                return {"label": "Enter the total", "disabled": "The previous year is locked — unlock it first."}
            return {
                "label": f"Enter {A.label(p)} = sum of parts",
                "confirm": f"Enter <b>{esc(A.label(p))}</b> ({PL.get(sc, sc)}) as the sum of its parts: <b>{esc(S.display_of(type('MockFact', (), {'concept': p, 'value': t['value'], 'nil': False})()))}</b>.",
                "apply": lambda p=p: S.set_total_from_parts(p, fact.period, fact.dims),
            }
        return None

    if issue.get("ruleId") == "GR-1" and fact and issue.get("calc") and "Calculation inconsistency" in msg and fact.origin != "calculated":
        t = S.total_from_parts(fact.concept, fact.period, fact.dims)
        if not t:
            return None
        sc = scope_of_fact(fact)
        if locked(sc):
            return {"label": "Set total = sum of parts", "disabled": "The previous year is locked — unlock it first."}
        return {
            "label": "Set total = sum of parts",
            "confirm": f"Replace <b>{esc(A.label(fact.concept))}</b> ({PL.get(sc, sc)}) with the sum of its parts <b>{esc(S.display_of(type('MockFact', (), {'concept': fact.concept, 'value': t['value'], 'nil': False})()))}</b>?",
            "apply": lambda: S.set_total_from_parts(fact.concept, fact.period, fact.dims),
        }

    for l in statement_note_links(A).values():
        if l.get("kind") != "sum" or l.get("ruleId") != issue.get("ruleId"):
            continue
        sc = "PY" if issue.get("scope") == "PY" else "CY"
        v = S.note_value(l, sc)
        p = f.period(l["concept"], sc)
        x = f.get(l["concept"], p, []) if p else None
        if not v or v.get("undetermined") or not x:
            continue
        if locked(sc):
            return {"label": "Take the figure from the note", "disabled": "The previous year is locked — unlock it first."}

        def apply_note_fig():
            total_str = Dec.to_string(v["total"])
            f.set_fact(
                concept=l["concept"],
                period=p,
                dims=[],
                value=total_str,
                decimals=v["decimals"],
                unit=v.get("unit") or x.unit,
                origin="calculated",
            )
            S.recalc_from(l["concept"], p, [], 0, {"before": x.value, "after": total_str})

        return {
            "label": "Take the figure from the note",
            "confirm": f"Set <b>{esc(A.label(l['concept']))}</b> ({PL.get(sc, sc)}) to the note figure <b>{esc(S.display_of(type('MockFact', (), {'concept': l['concept'], 'value': Dec.to_string(v['total']), 'nil': False})()))}</b>?",
            "apply": apply_note_fig,
        }

    m = re.search(r"'(.+)' is mandatory — not present for (CY|PY)", re.sub(r"^\[[^\]]+\]\s*", "", msg))
    if m and issue.get("concept") and A.is_numeric(issue["concept"]):
        return nil_fix(S, issue["concept"], m.group(2), issue.get("location"))

    if issue.get("ruleId") == "GR-6" and fact and A.is_numeric(fact.concept) and "current-year value should be entered" in msg:
        return nil_fix(S, fact.concept, "CY", None, fact.dims, fact)

    return None


fixFor = fix_for


def column_at_unusable_total(S: Any, fact: Any) -> Optional[Dict[str, Any]]:
    A = S.A
    p_dict = S.filing.meta.get("periods", {})
    for t in A.tables:
        if fact.concept not in t.get("lineItems", []) or not all(any(a["axis"] == d["axis"] for a in t.get("axes", [])) for d in fact.dims):
            continue
        need = unusable_default_axes(A, t, fact.dims)
        if need:
            return {"tableId": t["id"], "scope": reporting_year(p_dict, fact.period), "dims": fact.dims, "need": need}
    return None


columnAtUnusableTotal = column_at_unusable_total


def move_column_fix(S: Any, table_id: str, scope: str, dims: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    A = S.A
    need = unusable_default_axes(A, table_id, dims)
    if not need or scope not in ("CY", "PY"):
        return None
    label = "Move the column to a member"
    if S.py_locked(scope):
        return {"label": label, "disabled": "The previous year is locked — unlock it first."}
    facts = S.slice_facts(table_id, scope, dims)
    col = " · ".join(A.label(d.get("member") or d["axis"]) for d in dims) if dims else "the total column"
    return {
        "label": label,
        "choose": [{"axis": n["axis"], "label": A.label(n["axis"]), "options": [{"value": m, "label": A.label(m)} for m in n["members"]]} for n in need],
        "confirm": f"The column <b>{esc(col)}</b> leaves {A.label(need[0]['axis'])} at its total, which is not usable. Choose the member to move its {len(facts)} value(s) to:",
        "apply": lambda chosen=None: S.move_slice_to_members(table_id, scope, dims, [{"axis": n["axis"], "member": chosen[i] if (chosen and i < len(chosen)) else n["members"][0]} for i, n in enumerate(need)]),
    }


moveColumnFix = move_column_fix


def single_member_fix(S: Any, issue: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    A = S.A
    f = S.filing
    sc = "PY" if issue.get("scope") == "PY" else "CY"
    t = A.table(issue["tableId"])
    axes = {a["axis"] for a in t.get("axes", [])}
    p_dict = f.meta.get("periods", {})
    facts = [
        x
        for x in f.all()
        if x.concept == issue["concept"]
        and not x.nil
        and x.dims
        and all(d["axis"] in axes for d in x.dims)
        and reporting_year(p_dict, x.period) == sc
    ]
    if len(facts) < 2:
        return None
    label = "Keep it under one member"
    if S.py_locked(sc):
        return {"label": label, "disabled": "The previous year is locked — unlock it first."}

    def name(x: Any) -> str:
        return " · ".join(A.label(d.get("member")) or str(d.get("typed", "")) for d in x.dims)

    def preview(x: Any) -> str:
        v = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(x.value))).strip()
        return (v[:50] + "…") if len(v) > 50 else v

    def apply_single(chosen: Any = None):
        keep_idx = int(chosen[0]) if (chosen and len(chosen) > 0) else 0
        for i, x in enumerate(facts):
            if i != keep_idx:
                S.set_table_value(issue["tableId"], sc, x.dims, x.concept, None, recalc=True)

    return {
        "label": label,
        "choose": [{"label": "Keep it under", "options": [{"value": str(i), "label": f"{name(x)} — {preview(x)}"} for i, x in enumerate(facts)]}],
        "confirm": f"<b>{esc(A.label(issue['concept']))}</b> is given under {len(facts)} members; choose which one to keep:",
        "apply": apply_single,
    }


def column_total_fix(S: Any, fact: Any) -> Optional[Dict[str, Any]]:
    c = column_at_unusable_total(S, fact)
    return move_column_fix(S, c["tableId"], c["scope"], c["dims"]) if c else None


def share_capital_fix(S: Any, issue: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    A = S.A
    f = S.filing
    fact = f.facts.get(issue["factKey"]) if issue.get("factKey") else None
    if not fact or fact.nil or fact.origin == "calculated":
        return None
    label = "Confirm as the actual value"
    pow10 = SCALE_POWERS.get(f.meta.get("level", "Actual"), 0)
    dp = int(f.meta.get("displayPlaces", 0) or 0)
    if dp < pow10:
        return {"label": label, "disabled": f"First choose at least {pow10} decimal places on the company page."}
    p_dict = f.meta.get("periods", {})
    sc = reporting_year(p_dict, fact.period)
    if S.py_locked(sc):
        return {"label": label, "disabled": "The previous year is locked — unlock it first."}
    rupees = group_in(Dec.to_string(Dec.parse(fact.value)))
    display = Dec.to_fixed(Dec.parse(to_display(fact.value, f.meta.get("level", "Actual"))), pow10)

    def apply_sc():
        x = f.facts.get(fact.key)
        if not x or x.nil:
            raise ValueError("The value is no longer there")
        f.set_fact(
            concept=x.concept,
            period=x.period,
            dims=x.dims,
            value=x.value,
            decimals=str(f.typed_decimals(pow10, x.value)),
            unit=x.unit,
            origin=x.origin,
        )
        S.recalc_from(x.concept, x.period, x.dims, 0, {"before": x.value, "after": x.value})

    return {
        "label": label,
        "confirm": f"Report <b>{esc(A.label(fact.concept))}</b> as exactly <b>₹{esc(rupees)}</b> ({esc(display)} in {esc(f.meta.get('level'))})?",
        "apply": apply_sc,
    }


def nil_fix(
    S: Any,
    concept: str,
    scope: str,
    loc: Optional[Dict[str, Any]] = None,
    dims: Optional[List[Dict[str, Any]]] = None,
    prev_fact: Optional[Any] = None,
) -> Dict[str, Any]:
    A = S.A
    if S.py_locked(scope):
        return {"label": "Report nil (0)", "disabled": "The previous year is locked — unlock it first."}
    label = "Report nil (0)"
    prev_str = f" (the previous year reports {esc(S.display_of(prev_fact))})" if prev_fact else ""
    confirm = f"Report <b>{esc(A.label(concept))}</b> as <b>0</b> for the {PL.get(scope, scope)}{prev_str}?"

    def apply_nil():
        period = S.filing.period(concept, scope)
        t = cell_for(S, {"concept": concept, "period": period, "dims": dims or []})
        if "why" in t:
            raise ValueError(f"No cell for this value: {t['why']}")
        if t.get("kind") == "row":
            return S.set_value(concept, t["scope"], "0", preferred_label=t.get("preferredLabel"), tab=t.get("elrUri"), recalc=True)
        return S.set_table_value(t["tableId"], t["scope"], t.get("dims", []), concept, "0", preferred_label=t.get("preferredLabel"), recalc=True, lock_calculated=True)

    return {"label": label, "confirm": confirm, "apply": apply_nil}
