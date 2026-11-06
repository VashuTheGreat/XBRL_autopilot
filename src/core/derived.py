"""Derived cells beyond the calculation linkbase — read from the taxonomy and compiled MCA rules.

Used by the Session to auto-populate (and lock) cells exactly like calculation parents:
  - carrying amount (gross - accumulated)
  - roll-forward closing (opening + net changes)
  - statement figures supplied by notes
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple
from .dimensions import dimensionally_valid, nondim_allowed
from .views import build_elr_view, build_table_view, total_column_allowed

_CACHE: Dict[int, Dict[str, Any]] = {}
NUMERIC_KINDS: Set[str] = {"monetary", "shares"}


def derivations(A: Any) -> Dict[str, Any]:
    a_id = id(A)
    if a_id in _CACHE:
        return _CACHE[a_id]

    arith: Dict[str, Dict[str, Any]] = {}
    for r in A.rules.get("rules", []):
        a = r.get("ast", {})
        if r.get("status") != "EXECUTABLE" or a.get("type") != "memberArith":
            continue
        axis = a.get("axis")
        target = a.get("target")
        if target != A.dimension_default(axis):
            continue
        if axis not in arith:
            concepts: Set[str] = set()
            for t in A.tables:
                if any(x.get("axis") == axis for x in t.get("axes", [])):
                    for q in t.get("lineItems", []):
                        c = A.concept(q)
                        if c and not c.get("abstract") and A.data_type(q) == "monetary":
                            concepts.add(q)
            arith[axis] = {
                "axis": axis,
                "target": target,
                "plus": a.get("plus", []),
                "minus": a.get("minus", []),
                "concepts": concepts,
                "rules": [],
            }
        arith[axis]["rules"].append(r.get("id"))

    by_closing: Dict[str, Optional[str]] = {}
    seen_change: Dict[str, Set[str]] = {}

    for elr, arcs in A.json.get("presentation", {}).items():
        code = (A.json.get("roles", {}).get(elr, {}).get("code") or "")[:6]
        if code == "400400":
            continue
        kids: Dict[str, List[Any]] = {}
        for x in arcs:
            kids.setdefault(x["from"], []).append(x)
        for lst in kids.values():
            lst.sort(key=lambda item: item.get("order", 0))

        def last_total(q_from: str) -> Optional[str]:
            t_arcs = [x for x in kids.get(q_from, []) if (x.get("preferredLabel") or "").endswith("totalLabel")]
            return t_arcs[-1]["to"] if t_arcs else None

        for lst in kids.values():
            for s in lst:
                if not (s.get("preferredLabel") or "").endswith("periodStartLabel"):
                    continue
                s_to = s["to"]
                e = next(
                    (x for x in lst if x["to"] == s_to and (x.get("preferredLabel") or "").endswith("periodEndLabel")),
                    None,
                )
                c_s = A.concept(s_to)
                if not e or not c_s or c_s.get("periodType") != "instant" or A.data_type(s_to) not in NUMERIC_KINDS:
                    continue

                cands = []
                for x in lst:
                    if x.get("order", 0) <= s.get("order", 0) or x.get("order", 0) >= e.get("order", 0):
                        continue
                    x_to = x["to"]
                    c_x = A.concept(x_to)
                    if not c_x:
                        continue
                    if c_x.get("abstract"):
                        tot = last_total(x_to)
                        if tot:
                            cands.append(tot)
                    elif c_x.get("periodType") == "duration" and A.data_type(x_to) == A.data_type(s_to):
                        cands.append(x_to)

                uniq = list(dict.fromkeys(cands))
                if len(uniq) != 1:
                    continue
                ch = uniq[0]
                c_ch = A.concept(ch)
                if not c_ch or c_ch.get("periodType") != "duration":
                    continue
                if s_to in by_closing and by_closing[s_to] != ch:
                    by_closing[s_to] = None
                    continue
                by_closing[s_to] = ch
                seen_change.setdefault(ch, set()).add(s_to)

    for x in list(by_closing.keys()):
        ch = by_closing[x]
        if not ch or len(seen_change.get(ch, set())) != 1:
            del by_closing[x]

    by_change: Dict[str, str] = {ch: x for x, ch in by_closing.items() if ch}

    out = {"arith": arith, "byClosing": by_closing, "byChange": by_change}
    _CACHE[a_id] = out
    return out


def carrying_rule_for(A: Any, concept: str, dims: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    deriv = derivations(A)
    for d in deriv["arith"].values():
        if concept not in d["concepts"] or any(x.get("axis") == d["axis"] for x in dims):
            continue
        axis = d["axis"]
        plus = [
            dims + [{"axis": axis, "member": m}]
            for m in d["plus"]
            if dimensionally_valid(A, concept, dims + [{"axis": axis, "member": m}]).get("valid")
        ]
        minus = [
            dims + [{"axis": axis, "member": m}]
            for m in d["minus"]
            if dimensionally_valid(A, concept, dims + [{"axis": axis, "member": m}]).get("valid")
        ]
        if not plus and not minus:
            continue
        res = dict(d)
        res["plusDims"] = plus
        res["minusDims"] = minus
        return res
    return None


carryingRuleFor = carrying_rule_for


def carrying_target_of(A: Any, concept: str, dims: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    deriv = derivations(A)
    for d in deriv["arith"].values():
        if concept not in d["concepts"]:
            continue
        m = next((x for x in dims if x.get("axis") == d["axis"]), None)
        if not m or m.get("member") not in (d["plus"] + d["minus"]):
            continue
        return [x for x in dims if x.get("axis") != d["axis"]]
    return None


carryingTargetOf = carrying_target_of


def roll_forward_change_of(A: Any, concept: str) -> Optional[str]:
    return derivations(A)["byClosing"].get(concept)


rollForwardChangeOf = roll_forward_change_of


def roll_forward_closing_of(A: Any, change: str) -> Optional[str]:
    return derivations(A)["byChange"].get(change)


rollForwardClosingOf = roll_forward_closing_of

_LINKS_CACHE: Dict[int, Dict[str, Dict[str, Any]]] = {}


def statement_note_links(A: Any) -> Dict[str, Dict[str, Any]]:
    a_id = id(A)
    if a_id in _LINKS_CACHE:
        return _LINKS_CACHE[a_id]

    out: Dict[str, Dict[str, Any]] = {}
    statements = [e for e in A.elrs if e.get("group") == "Statements"]
    notes = [e for e in A.elrs if e.get("group") == "Notes"]

    def elr_code(uri: str) -> str:
        e = A.elr(uri)
        return (e.get("code") or "")[:6] if e else ""

    parent_in: Dict[str, Set[str]] = {}
    for elr, arcs in A.json.get("calculation", {}).items():
        role = A.json.get("roles", {}).get(elr, {})
        c = (role.get("code") or "")[:6]
        for a in arcs:
            parent_in.setdefault(a["from"], set()).add(c)

    rows: Dict[str, Set[str]] = {}
    for e in statements:
        view = build_elr_view(A, e.get("uri"))
        for r in view.get("rows", []):
            if r.get("kind") == "item" and A.is_numeric(r.get("concept")):
                rows.setdefault(r["concept"], set()).add(elr_code(e.get("uri")))

    def own_total(q: str) -> bool:
        stmt_codes = rows.get(q, set())
        p_codes = parent_in.get(q, set())
        return any(c in p_codes for c in stmt_codes)

    def line_row(t: Dict[str, Any], q: str) -> Optional[str]:
        items = [l for l in build_table_view(A, t["id"])["lineItems"] if l["concept"] == q]
        match = (
            next((l for l in items if l.get("preferredLabel") == "periodEndLabel"), None)
            or next((l for l in items if l.get("preferredLabel") != "periodStartLabel"), None)
            or (items[0] if items else None)
        )
        return match.get("preferredLabel") if match else None

    def note_table(q: str, axis: str, fixed: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        fixed = fixed or {}
        for t in A.tables:
            pres = t.get("presentationElr")
            e = A.elr(pres)
            if not e or e.get("group") != "Notes":
                continue
            if q not in t.get("lineItems", []):
                continue
            if not any(x.get("axis") == axis for x in t.get("axes", [])):
                continue
            if all(any(x.get("axis") == ax for x in t.get("axes", [])) for ax in fixed.keys()):
                return t
        return None

    def cmps(n: Any) -> List[Any]:
        if not n or not isinstance(n, dict):
            return []
        op = n.get("op")
        if op == "and":
            res = []
            for arg in n.get("args", []):
                res.extend(cmps(arg))
            return res
        if op == "cmp":
            return [n]
        return []

    # 1. MCA rules: statement figure = sum of note element over an axis
    for r in A.rules.get("rules", []):
        if r.get("status") != "EXECUTABLE":
            continue
        ast = r.get("ast", {})
        if ast.get("type") != "assert":
            continue
        for c in cmps(ast.get("assert")):
            if c.get("cmp") != "==":
                continue
            for s, o in ((c.get("l"), c.get("r")), (c.get("r"), c.get("l"))):
                if not s or not isinstance(s, dict) or not s.get("fact"):
                    continue
                if s.get("ctx") != "nondim" or s["fact"] not in rows or not o or not o.get("sumAxis"):
                    continue
                if own_total(s["fact"]):
                    continue
                spec = o["sumAxis"]
                t = note_table(spec.get("concept"), spec.get("axis"), spec.get("fixed"))
                if not t:
                    continue
                prev = out.get(s["fact"])
                if prev and (prev.get("kind") != "sum" or prev.get("target") == s["fact"] or spec.get("concept") != s["fact"]):
                    continue
                out[s["fact"]] = {
                    "concept": s["fact"],
                    "kind": "sum",
                    "ruleId": r.get("id"),
                    "spec": spec,
                    "target": spec.get("concept"),
                    "tableId": t.get("id"),
                    "elrUri": t.get("presentationElr"),
                    "preferredLabel": line_row(t, spec.get("concept")),
                }

    # 2. identical element is a total in a note
    for q in rows.keys():
        if q in out or own_total(q) or not nondim_allowed(A, q):
            continue
        link: Optional[Dict[str, Any]] = None
        for e in notes:
            view = build_elr_view(A, e.get("uri"))
            r_item = next((x for x in view.get("rows", []) if x.get("kind") == "item" and x.get("concept") == q), None)
            if r_item and elr_code(e.get("uri")) in parent_in.get(q, set()):
                link = {
                    "concept": q,
                    "kind": "row",
                    "target": q,
                    "elrUri": e.get("uri"),
                    "preferredLabel": r_item.get("preferredLabel"),
                }
                break

        if not link:
            for t in A.tables:
                e = A.elr(t.get("presentationElr"))
                if e and e.get("group") == "Notes" and len(t.get("axes", [])) > 0:
                    if q in t.get("lineItems", []) and total_column_allowed(A, t.get("id")):
                        link = {
                            "concept": q,
                            "kind": "column",
                            "target": q,
                            "tableId": t.get("id"),
                            "elrUri": t.get("presentationElr"),
                            "preferredLabel": line_row(t, q),
                        }
                        break
        if link:
            out[q] = link

    _LINKS_CACHE[a_id] = out
    return out


statementNoteLinks = statement_note_links

_BY_TARGET_CACHE: Dict[int, Dict[str, List[Dict[str, Any]]]] = {}


def statement_links_from(A: Any, concept: str) -> List[Dict[str, Any]]:
    a_id = id(A)
    if a_id not in _BY_TARGET_CACHE:
        m: Dict[str, List[Dict[str, Any]]] = {}
        for l in statement_note_links(A).values():
            if l.get("kind") == "sum":
                m.setdefault(l["target"], []).append(l)
        _BY_TARGET_CACHE[a_id] = m
    return _BY_TARGET_CACHE[a_id].get(concept, [])


statementLinksFrom = statement_links_from
