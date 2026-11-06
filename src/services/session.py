"""Application controller: the only API the UI talks to.

Enforces applicability and dimensional validity on every write.
"""

from __future__ import annotations
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union

from src.core import decimal as Dec
from src.core.model import Filing, FactValueError, norm_dims, dim_key
from src.core.dimensions import (
    check_dimension_syntax,
    dimensionally_valid,
    next_typed_member,
    nondim_allowed,
    unusable_default_axes,
)
from src.core.views import (
    build_elr_view,
    build_table_view,
    table_slices,
    total_column_allowed,
    nondim_row_concepts,
    nondim_row_elrs,
)
from src.core.periods import reporting_year, opening_period_for, scope_of
from src.core.derived import (
    carrying_rule_for,
    carrying_target_of,
    roll_forward_change_of,
    roll_forward_closing_of,
    statement_note_links,
    statement_links_from,
    derivations,
)
from src.core.scaling import to_display
from src.engine.applicability import Applicability, ApplicabilityError
from src.engine.gate import Gate, export_xml, SHARE_CAPITAL
from src.engine.rules import RuleEngine
from .importer import import_instance, CashFlowChoiceError


class DimensionError(Exception):
    def __init__(self, msg: str, details: Optional[Any] = None):
        super().__init__(msg)
        self.details = details


class CalculatedCellError(Exception):
    pass


class PyLockedError(Exception):
    pass


PY_LOCKED = "The previous year is locked: it carries last year's filed figures. Unlock the previous year (tab tools) to change it."

_CALC_CACHE: Dict[int, Dict[str, Any]] = {}


def calc_index(A: Any) -> Dict[str, Any]:
    a_id = id(A)
    if a_id in _CALC_CACHE:
        return _CALC_CACHE[a_id]

    parents_by_child: Dict[str, List[Dict[str, Any]]] = {}
    children_of: Dict[str, List[Any]] = {}
    by_parent: Dict[str, List[Dict[str, Any]]] = {}

    for elr, arcs in A.json.get("calculation", {}).items():
        role = A.json.get("roles", {}).get(elr, {})
        code = (role.get("code") or "")[:6]
        for a in arcs:
            parents_by_child.setdefault(a["to"], []).append({"elr": elr, "code": code, "parent": a["from"]})
            k = f"{elr}|{a['from']}"
            children_of.setdefault(k, []).append(a)
            by_parent.setdefault(a["from"], []).append({"elr": elr, "code": code})

    ex = RuleEngine(A).calc_exemptions()
    soft: Set[str] = set()
    for k, arcs in children_of.items():
        if all(a["to"] in ex for a in arcs):
            soft.add(k)

    idx = {"parentsByChild": parents_by_child, "childrenOf": children_of, "byParent": by_parent, "soft": soft}
    _CALC_CACHE[a_id] = idx
    return idx


def sum_decimals(facts: List[Any], total: Dec.Dec, floor: Optional[Union[str, int]] = None) -> str:
    non_zero = [
        x
        for x in facts
        if not (x.value is not None and Dec.is_decimal_string(str(x.value)) and Dec.is_zero(Dec.parse(x.value)))
    ]
    decs = [
        int(x.decimals)
        for x in non_zero
        if x.decimals is not None and x.decimals != "INF"
    ]
    if not decs:
        return "INF"
    min_d = min(decs)
    if floor == "EXACT":
        need = Dec.required_decimals(total)
        return str(max(min_d, -1_000_000_000 if need == float("inf") else int(need)))
    if floor is None or floor == "INF":
        return str(min_d)

    floor_num = int(floor)
    for x in non_zero:
        if x.decimals != "INF" or x.value is None or not Dec.is_decimal_string(str(x.value)):
            continue
        r = Dec.required_decimals(Dec.parse(x.value))
        if r != float("inf"):
            floor_num = max(floor_num, int(r))

    req = Dec.required_decimals(total)
    return str(max(min_d, min(floor_num, min_d if req == float("inf") else int(req))))


def round_to_decimals(total: Dec.Dec, decimals: Optional[str]) -> Dec.Dec:
    return total if (decimals is None or decimals == "INF") else Dec.round_dec(total, int(decimals))


def floor_for(filing: Any, concept: str) -> Optional[Union[str, int]]:
    return "EXACT" if concept.split(":")[-1] in SHARE_CAPITAL else filing.statement_decimals(concept)


def same_display(session: Any, fact: Any, display: Any) -> bool:
    if not fact or fact.nil or display is None:
        return False
    shown = str(session.display_of(fact)).replace(",", "").strip()
    typed = str(display).replace(",", "").strip()
    if typed == "":
        return False
    if session.A.is_numeric(fact.concept):
        return Dec.is_decimal_string(typed) and Dec.is_decimal_string(shown) and Dec.eq(Dec.parse(typed), Dec.parse(shown))
    return typed == shown


def agrees(x: Any, sum_result: Dict[str, Any]) -> bool:
    d = "INF" if (x.decimals is None or x.decimals == "INF") else int(x.decimals)
    return Dec.eq(Dec.round_dec(Dec.parse(x.value), d), Dec.round_dec(sum_result["total"], d))


class Session:
    def __init__(self, authority: Any, filing: Optional[Filing] = None):
        self.A = authority
        self.app = Applicability(authority)
        self.filing = filing or Filing(authority)
        self._views: Dict[str, Any] = {}

    def set_meta(self, patch: Dict[str, Any]) -> None:
        old_cy_end = self.filing.meta.get("periods", {}).get("cy", {}).get("end")
        self.filing.meta.update(patch)
        if "periods" in patch:
            self.filing.meta["periods"] = dict(self.filing.meta.get("periods", {}))
            self.filing.meta["periods"].update(patch["periods"] or {})

        f = self.filing
        A = self.A
        P = f.meta.get("periods", {})
        if f.meta.get("yearMode") == "current" and old_cy_end and P.get("cy", {}).get("end") and P["cy"]["end"] != old_cy_end:
            f.meta["yearMode"] = "both"

        def mirror(local: str, val: Any, scopes: Tuple[str, ...] = ("CY",)):
            q = A.qname_of_local(local)
            if not q or val is None or val == "":
                return
            for s in scopes:
                p = f.period(q, s)
                if p:
                    f.set_fact(concept=q, period=p, value=val, origin="meta", lang=None if A.is_numeric(q) else "en")

        cy_start = P.get("cy", {}).get("start")
        cy_end = P.get("cy", {}).get("end")
        if cy_start and cy_end:
            mirror("CorporateIdentityNumber", f.meta.get("cin"))
            mirror("NatureOfReportStandaloneConsolidated", f.meta.get("reportType"))
            mirror("LevelOfRoundingUsedInFinancialStatements", f.meta.get("level"))
            mirror("DateOfStartOfReportingPeriod", cy_start)
            mirror("DateOfEndOfReportingPeriod", cy_end)
            py_start = P.get("py", {}).get("start")
            py_end = P.get("py", {}).get("end")
            if not f.meta.get("firstFinancialYear") and py_start and py_end:
                qs = A.qname_of_local("DateOfStartOfReportingPeriod")
                qe = A.qname_of_local("DateOfEndOfReportingPeriod")
                if qs:
                    f.set_fact(concept=qs, period=f.period(qs, "PY"), value=py_start, origin="meta")
                if qe:
                    f.set_fact(concept=qe, period=f.period(qe, "PY"), value=py_end, origin="meta")

        f.revision += 1

    setMeta = set_meta

    def elr_view(self, uri: str) -> Dict[str, Any]:
        if uri not in self._views:
            self._views[uri] = build_elr_view(self.A, uri)
        return self._views[uri]

    elrView = elr_view

    def table_view(self, table_id: str) -> Dict[str, Any]:
        k = f"T{table_id}"
        if k not in self._views:
            self._views[k] = build_table_view(self.A, table_id)
        return self._views[k]

    tableView = table_view

    def elr_status(self, uri: str, scope: str) -> Dict[str, Any]:
        return self.app.elr_status(self.filing, uri, scope)

    elrStatus = elr_status

    def concept_status(self, q: str, scope: str) -> Dict[str, Any]:
        return self.app.concept_status(self.filing, q, scope)

    conceptStatus = concept_status

    def table_status(self, table_id: str, scope: str) -> Dict[str, Any]:
        return self.app.table_status(self.filing, table_id, scope)

    tableStatus = table_status

    def period_for_cell(self, concept: str, scope: str, preferred_label: Optional[str] = None) -> Optional[Dict[str, str]]:
        c = self.A.concept(concept)
        if c and c.get("periodType") == "instant" and preferred_label == "periodStartLabel":
            return opening_period_for(self.filing.meta.get("periods", {}), scope)
        return self.filing.period(concept, scope)

    periodForCell = period_for_cell

    def get_value(self, concept: str, scope: str, dims: Optional[List[Dict[str, Any]]] = None, preferred_label: Optional[str] = None) -> Any:
        p = self.period_for_cell(concept, scope, preferred_label)
        return self.filing.get(concept, p, dims or []) if p else None

    getValue = get_value

    def display_of(self, fact: Any) -> str:
        if not fact or fact.nil:
            return ""
        if self.A.data_type(fact.concept) == "monetary":
            return to_display(fact.value, self.filing.meta.get("level", "Actual"))
        return fact.value or ""

    displayOf = display_of

    def py_locked(self, scope: str, unlock_py: bool = False) -> bool:
        return scope == "PY" and bool(self.filing.meta.get("pyLocked")) and not unlock_py

    pyLocked = py_locked

    def set_value(
        self,
        concept: str,
        scope: str,
        display: Any,
        preferred_label: Optional[str] = None,
        tab: Optional[str] = None,
        recalc: bool = False,
        override: bool = False,
        unlock_py: bool = False,
        strict: bool = False,
    ) -> Any:
        if self.py_locked(scope, unlock_py):
            raise PyLockedError(PY_LOCKED)
        st = self.app.cell_status(self.filing, tab, concept, scope) if tab else self.app.concept_status(self.filing, concept, scope)
        if not st["applicable"]:
            raise ApplicabilityError(f"{concept} is not applicable for {scope}", st.get("reasons", []))
        if not nondim_allowed(self.A, concept):
            raise DimensionError(f"{concept} can only be reported inside its table")

        lock = self.calculated_cell(concept, scope, [], tab, preferred_label) if (tab and not override) else None
        if lock and not (lock.get("note") and self.nil_allowed(lock["note"], concept, scope, display, preferred_label)):
            cur = self.get_value(concept, scope, [], preferred_label)
            if same_display(self, cur, display):
                return cur
            if lock.get("note"):
                raise CalculatedCellError(f"{self.A.label(concept)} is taken from its note — enter it there, or enable editing of calculated cells for this tab to override it")
            raise CalculatedCellError(f"{self.A.label(concept)} is calculated from its child elements — enable editing of calculated cells for this tab to override it")

        p = self.period_for_cell(concept, scope, preferred_label)
        if not p:
            raise FactValueError("Reporting periods are not set")

        before = self.filing.get(concept, p, [])
        was = before.value if before and not before.nil else None
        calc = self.calculated_cell(concept, scope, [], tab, preferred_label) if (override and tab) else None
        f = self.filing.set_display_value(concept=concept, period=p, display=display, strict=strict)
        if f and calc:
            f.origin = "override"
        if recalc:
            self.recalc_from(concept, p, [], 0, {"before": was, "after": f.value if f and not f.nil else None})
        return f

    setValue = set_value

    def calculated_cell(
        self,
        concept: str,
        scope: str,
        dims: Optional[List[Dict[str, Any]]] = None,
        tab_elr_uri: Optional[str] = None,
        preferred_label: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        A = self.A
        f = self.filing
        idx = calc_index(A)
        code = (A.elr(tab_elr_uri).get("code") or "")[:6] if tab_elr_uri else None
        nd = norm_dims(dims)
        p = self.period_for_cell(concept, scope, preferred_label)
        if not p:
            return None

        nl = None if nd else self.note_link(concept, scope, tab_elr_uri)
        if nl:
            x = f.get(concept, p, [])
            if nl.get("kind") != "sum":
                return {"note": nl, "children": []}
            v = self.note_value(nl, scope)
            if not v or not v.get("undetermined"):
                if not x or x.nil or x.origin in ("calculated", "override"):
                    return {"note": nl, "children": []}
                if agrees(x, v) if v else Dec.eq(Dec.parse(x.value), Dec.ZERO):
                    return {"note": nl, "children": []}

        for item in idx["byParent"].get(concept, []):
            elr = item["elr"]
            c = item["code"]
            if code and c != code:
                continue
            if f"{elr}|{concept}" in idx["soft"]:
                continue
            pres = next((e for e in A.elrs if e.get("code") == c), None)
            if pres and not self.app.elr_status(f, pres.get("uri"), scope)["applicable"]:
                continue
            sum_res = self.network_sum(elr, concept, p, nd)
            if not sum_res["count"]:
                continue
            x = f.get(concept, p, nd)
            if x and not x.nil and (x.origin in ("calculated", "override") or agrees(x, sum_res)):
                kids_list = [a["to"] for a in idx["childrenOf"].get(f"{elr}|{concept}", [])]
                return {"elr": elr, "children": kids_list}

        return self.derived_cell(concept, scope, dims, preferred_label, tab_elr_uri)

    calculatedCell = calculated_cell

    def derived_cell(
        self,
        concept: str,
        scope: str,
        dims: Optional[List[Dict[str, Any]]] = None,
        preferred_label: Optional[str] = None,
        tab_elr_uri: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        A = self.A
        f = self.filing
        if not A.is_numeric(concept):
            return None
        nd = norm_dims(dims)
        if not nd and tab_elr_uri and tab_elr_uri in nondim_row_elrs(A).get(concept, set()):
            return None
        p = self.period_for_cell(concept, scope, preferred_label)
        if not p:
            return None
        if self.statement_figure(concept, p, nd):
            return None
        r = carrying_rule_for(A, concept, nd)
        if r and any(f.get(concept, p, norm_dims(d)) for d in (r.get("plusDims", []) + r.get("minusDims", []))):
            x = f.get(concept, p, nd)
            v = self.carrying_value(concept, p, nd)
            if not x or x.nil:
                return None
            if x.origin not in ("calculated", "override") and v and not Dec.eq(Dec.parse(x.value), Dec.parse(v["value"])):
                return None
            return {"derived": "carrying", "rules": r.get("rules", []), "children": []}
        return None

    derivedCell = derived_cell

    def network_sum(
        self,
        elr: str,
        parent: str,
        period: Dict[str, Any],
        nd: List[Dict[str, Any]],
        override: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        f = self.filing
        arcs = calc_index(self.A)["childrenOf"].get(f"{elr}|{parent}", [])
        kids = []
        for a in arcs:
            fact = override.get("fact") if (override and a["to"] == override.get("concept")) else f.get(a["to"], period, nd)
            if fact and not getattr(fact, "nil", False) and getattr(fact, "value", None) is not None:
                kids.append({"a": a, "fact": fact})

        prods = [Dec.mul(Dec.parse(k["fact"].value), Dec.parse(str(k["a"].get("weight", 1)))) for k in kids]
        total = Dec.sum_dec(prods)
        decimals = sum_decimals([k["fact"] for k in kids], total, floor_for(f, parent))
        return {
            "count": len(kids),
            "total": round_to_decimals(total, decimals),
            "decimals": decimals,
            "unit": getattr(kids[0]["fact"], "unit", None) if kids else None,
            "kids": kids,
        }

    networkSum = network_sum

    def recalc_from(
        self,
        concept: str,
        period: Dict[str, Any],
        dims: Optional[List[Dict[str, Any]]] = None,
        depth: int = 0,
        change: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> None:
        if depth > 40:
            return
        A = self.A
        f = self.filing
        idx = calc_index(A)
        nd = norm_dims(dims)
        seen: Set[str] = set()

        for item in idx["parentsByChild"].get(concept, []):
            parent = item["parent"]
            elr = item["elr"]
            code = item["code"]
            if parent in seen:
                continue
            pc = A.concept(parent)
            if not pc or (pc.get("periodType") == "instant") != (period.get("type") == "instant"):
                continue
            pres = next((e for e in A.elrs if e.get("code") == code), None)
            scope = reporting_year(f.meta.get("periods", {}), period)
            if scope not in ("CY", "PY"):
                continue
            if pres and not self.app.elr_status(f, pres.get("uri"), scope)["applicable"]:
                continue
            if not self.app.concept_status(f, parent, scope)["applicable"]:
                continue
            if not (dimensionally_valid(A, parent, nd).get("valid") if nd else nondim_allowed(A, parent)):
                continue

            existing = f.get(parent, period, nd)
            if existing and existing.origin == "override":
                seen.add(parent)
                continue

            now = self.network_sum(elr, parent, period, nd)
            typed = existing and not existing.nil and existing.origin != "calculated"
            if typed and not force:
                if f"{elr}|{parent}" in idx["soft"]:
                    seen.add(parent)
                    continue
                old_override = (
                    {"concept": concept, "fact": None if change.get("before") is None else type("FactStub", (), {"value": change["before"], "decimals": "INF", "nil": False, "unit": "INR"})()}
                    if (change and concept != parent)
                    else None
                )
                old = self.network_sum(elr, parent, period, nd, old_override) if old_override else None
                if not old or not old["count"] or not agrees(existing, old):
                    seen.add(parent)
                    continue

            seen.add(parent)
            if not now["count"]:
                if existing and existing.origin == "calculated":
                    f.remove_fact(existing.key)
                    self.recalc_from(parent, period, nd, depth + 1, {"before": existing.value, "after": None}, force=force)
                continue

            value_str = Dec.to_string(now["total"])
            if not (existing and not existing.nil and existing.value == value_str and existing.decimals == now["decimals"]):
                f.set_fact(
                    concept=parent,
                    period=period,
                    dims=nd,
                    value=value_str,
                    decimals=now["decimals"],
                    unit=now["unit"],
                    origin="calculated",
                )
            self.recalc_from(
                parent,
                period,
                nd,
                depth + 1,
                {"before": existing.value if existing and not existing.nil else None, "after": value_str},
                force=force,
            )

        self.derive_from(concept, period, nd, depth, force, change)

    recalcFrom = recalc_from

    def derive_from(
        self,
        concept: str,
        period: Dict[str, Any],
        nd: List[Dict[str, Any]],
        depth: int,
        force: bool = False,
        change: Optional[Dict[str, Any]] = None,
    ) -> None:
        A = self.A
        f = self.filing
        if not A.is_numeric(concept):
            return
        self.derive_statements(concept, period, nd, depth, force, change)
        td = carrying_target_of(A, concept, nd)
        if td is not None:
            tdn = norm_dims(td)

            def prior():
                if not change:
                    return None
                now = self.carrying_value(concept, period, tdn)
                if not now:
                    return None
                r = carrying_rule_for(A, concept, tdn)
                minus = any(dim_key(norm_dims(d)) == dim_key(nd) for d in r.get("minusDims", []))
                before_val = Dec.ZERO if change.get("before") is None else Dec.parse(change["before"])
                after_val = Dec.ZERO if change.get("after") is None else Dec.parse(change["after"])
                delta = Dec.sub(after_val, before_val)
                return Dec.add(Dec.parse(now["value"]), delta) if minus else Dec.sub(Dec.parse(now["value"]), delta)

            self.apply_derived(concept, period, tdn, depth, lambda: self.carrying_value(concept, period, tdn), force=force, prior=prior)

        P = f.meta.get("periods", {})
        s = scope_of(P, period)
        closing = roll_forward_closing_of(A, concept)
        if closing and s == "CY" and period.get("type") == "duration":
            cp = f.period(closing, "CY")
            if cp:
                self.apply_derived(closing, cp, nd, depth, lambda: self.roll_forward_value(closing, nd), soft=True, force=force)
        if s == "PY" and period.get("type") == "instant" and roll_forward_change_of(A, concept):
            cp = f.period(concept, "CY")
            if cp:
                self.apply_derived(concept, cp, nd, depth, lambda: self.roll_forward_value(concept, nd), soft=True, force=force)

    deriveFrom = derive_from

    def derive_statements(
        self,
        concept: str,
        period: Dict[str, Any],
        nd: List[Dict[str, Any]],
        depth: int,
        force: bool = False,
        change: Optional[Dict[str, Any]] = None,
    ) -> None:
        A = self.A
        links = statement_links_from(A, concept)
        if not links:
            return
        p_dict = self.filing.meta.get("periods", {})
        scope = reporting_year(p_dict, period)
        if scope not in ("CY", "PY"):
            return

        for l in links:
            sp = self.filing.period(l["concept"], scope)
            if not sp:
                continue

            def prior():
                if not change:
                    return None
                before_val = Dec.ZERO if change.get("before") is None else Dec.parse(change["before"])
                after_val = Dec.ZERO if change.get("after") is None else Dec.parse(change["after"])
                delta = Dec.sub(after_val, before_val)
                now = self.note_value(l, scope)
                return Dec.sub(now["total"], delta) if now else None

            def compute():
                v = self.note_value(l, scope)
                return None if (not v or v.get("undetermined")) else {"value": Dec.to_string(v["total"]), "from": [type("FakeFact", (), {"decimals": v["decimals"], "unit": v.get("unit"), "value": Dec.to_string(v["total"])})()]}

            self.apply_derived(l["concept"], sp, [], depth, compute, force=force, prior=prior)

    deriveStatements = derive_statements

    def carrying_value(self, concept: str, period: Dict[str, Any], dims: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        r = carrying_rule_for(self.A, concept, dims)
        if not r:
            return None
        get_f = lambda d: (self.filing.get(concept, period, norm_dims(d)) if not self.filing.get(concept, period, norm_dims(d)).nil else None) if self.filing.get(concept, period, norm_dims(d)) else None
        plus = [get_f(d) for d in r.get("plusDims", []) if get_f(d) is not None]
        minus = [get_f(d) for d in r.get("minusDims", []) if get_f(d) is not None]
        if not plus and not minus:
            return None
        v = Dec.sub(Dec.sum_dec(Dec.parse(x.value) for x in plus), Dec.sum_dec(Dec.parse(x.value) for x in minus))
        return {"value": Dec.to_string(v), "from": plus + minus}

    carryingValue = carrying_value

    def roll_forward_value(self, concept: str, dims: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        A = self.A
        f = self.filing
        ch = roll_forward_change_of(A, concept)
        if not ch:
            return None
        cf = f.get(ch, f.period(ch, "CY"), dims)
        if not cf or cf.nil:
            return None
        r = carrying_rule_for(A, concept, dims)
        if r and any(f.get(concept, f.period(concept, "CY"), norm_dims(d)) for d in (r.get("plusDims", []) + r.get("minusDims", []))):
            return None
        open_f = f.get(concept, f.period(concept, "PY"), dims)
        open_val = Dec.parse(open_f.value) if (open_f and not open_f.nil) else Dec.ZERO
        v = Dec.add(open_val, Dec.parse(cf.value))
        return {"value": Dec.to_string(v), "from": [cf] + ([open_f] if open_f and not open_f.nil else [])}

    rollForwardValue = roll_forward_value

    def apply_derived(
        self,
        concept: str,
        period: Dict[str, Any],
        dims: List[Dict[str, Any]],
        depth: int,
        compute: Callable[[], Optional[Dict[str, Any]]],
        soft: bool = False,
        force: bool = False,
        prior: Optional[Callable[[], Optional[Dec.Dec]]] = None,
    ) -> None:
        A = self.A
        f = self.filing
        scope = reporting_year(f.meta.get("periods", {}), period)
        if scope not in ("CY", "PY"):
            return
        if not self.app.concept_status(f, concept, scope)["applicable"]:
            return
        if not (dimensionally_valid(A, concept, dims).get("valid") if dims else nondim_allowed(A, concept)):
            return

        existing = f.get(concept, period, dims)
        if existing and existing.origin == "override":
            return
        if self.statement_figure(concept, period, dims):
            return
        if soft and not force and existing and not existing.nil and existing.origin != "calculated":
            return
        if not soft and not force and existing and not existing.nil and existing.origin != "calculated":
            before = prior() if prior else None
            if not before or not Dec.eq(Dec.parse(existing.value), before):
                return

        res = compute()
        if res is None:
            if existing and existing.origin == "calculated":
                f.remove_fact(existing.key)
                self.recalc_from(concept, period, dims, depth + 1, {"before": existing.value, "after": None}, force=force)
            return

        decimals = sum_decimals(res["from"], Dec.parse(res["value"]), floor_for(f, concept))
        rounded_val = Dec.to_string(round_to_decimals(Dec.parse(res["value"]), decimals))
        if existing and not existing.nil and existing.value == rounded_val and existing.decimals == decimals:
            return

        unit_val = res["from"][0].unit if res["from"] else None
        f.set_fact(
            concept=concept,
            period=period,
            dims=dims,
            value=rounded_val,
            decimals=decimals,
            unit=unit_val,
            origin="calculated",
        )
        self.recalc_from(
            concept,
            period,
            dims,
            depth + 1,
            {"before": existing.value if existing and not existing.nil else None, "after": rounded_val},
            force=force,
        )

    applyDerived = apply_derived

    def statement_figure(self, concept: str, period: Dict[str, Any], dims: List[Dict[str, Any]]) -> bool:
        if dims or concept not in nondim_row_concepts(self.A):
            return False
        x = self.filing.get(concept, period, [])
        return bool(x and not x.nil and x.origin not in ("calculated", "override"))

    statementFigure = statement_figure

    def note_link(self, concept: str, scope: str, tab_elr_uri: Optional[str] = None) -> Optional[Dict[str, Any]]:
        A = self.A
        f = self.filing
        e = A.elr(tab_elr_uri) if tab_elr_uri else None
        if not tab_elr_uri or not e or e.get("group") != "Statements":
            return None
        l = statement_note_links(A).get(concept)
        if not l:
            return None
        ok = (
            self.app.cell_status(f, l["elrUri"], l["target"], scope)["applicable"]
            if l.get("kind") == "row"
            else (self.app.table_status(f, l["tableId"], scope)["applicable"] and self.app.concept_status(f, l["target"], scope)["applicable"])
        )
        return l if ok else None

    noteLink = note_link

    def note_value(self, link: Dict[str, Any], scope: str, filing: Optional[Filing] = None) -> Optional[Dict[str, Any]]:
        filing_obj = filing or self.filing
        A = self.A
        spec = link["spec"]
        period = filing_obj.period(spec["concept"], scope)
        if not period:
            return None

        fixed = spec.get("fixed", {})
        facts = [
            x
            for x in filing_obj.facts_of(spec["concept"])
            if not x.nil
            and x.value is not None
            and x.period == period
            and any(d.get("axis") == spec["axis"] for d in x.dims)
            and all(any(d.get("axis") == ax and d.get("member") == mem for d in x.dims) for ax, mem in fixed.items())
        ]
        if not facts:
            return None

        level = spec.get("level")
        info = A.axis_info(spec["axis"])
        parents = info.get("parents", {}) if info else {}
        roots = [m for m in (info.get("members", {}).keys() if info else []) if m not in parents]

        def get_mem(f_obj: Any) -> str:
            d = next((y for y in f_obj.dims if y.get("axis") == spec["axis"]), None)
            return d.get("member") or f'"{d.get("typed")}"' if d else ""

        by_member: Dict[str, List[Any]] = {}
        for f in facts:
            by_member.setdefault(get_mem(f), []).append(f)

        picked: List[Any] = []
        if level == "all":
            picked = facts
        elif level == "firstLevel":
            children: Dict[str, List[str]] = {}
            for m, p_mem in parents.items():
                children.setdefault(p_mem, []).append(m)

            def take(m: str):
                if m in by_member:
                    picked.extend(by_member[m])
                    return
                for c in children.get(m, []):
                    take(c)

            for r in roots:
                for c in children.get(r, []):
                    take(c)
        else:
            picked = facts

        if not picked:
            return None
        total = Dec.sum_dec(Dec.parse(f.value) for f in picked)
        decimals = sum_decimals(picked, total, floor_for(filing_obj, link["concept"]))
        return {"total": round_to_decimals(total, decimals), "decimals": decimals, "unit": picked[0].unit, "count": len(picked)}

    noteValue = note_value

    def nil_allowed(self, link: Dict[str, Any], concept: str, scope: str, display: Any, preferred_label: Optional[str] = None) -> bool:
        t = str(display or "").replace(",", "").strip()
        if not Dec.is_decimal_string(t) or not Dec.eq(Dec.parse(t), Dec.ZERO):
            return False
        if link.get("kind") == "sum":
            return self.note_value(link, scope) is None
        cur = self.get_value(concept, scope, [], preferred_label)
        return not cur or cur.nil or Dec.eq(Dec.parse(cur.value), Dec.ZERO)

    nilAllowed = nil_allowed

    def refresh_calculated_cells(self) -> List[Dict[str, Any]]:
        A = self.A
        f = self.filing
        idx = calc_index(A)
        changed: List[Dict[str, Any]] = []

        def expected(x: Any) -> Optional[Dict[str, str]]:
            p_dict = f.meta.get("periods", {})
            scope = reporting_year(p_dict, x.period)
            if scope not in ("CY", "PY"):
                return None

            def derived(v: Dict[str, Any]) -> Dict[str, str]:
                d = sum_decimals(v["from"], Dec.parse(v["value"]), floor_for(f, x.concept))
                return {"value": Dec.to_string(round_to_decimals(Dec.parse(v["value"]), d)), "decimals": d}

            cands = []
            r = carrying_rule_for(A, x.concept, x.dims)
            if r and any(f.get(x.concept, x.period, norm_dims(d)) for d in (r.get("plusDims", []) + r.get("minusDims", []))):
                v = self.carrying_value(x.concept, x.period, x.dims)
                if v:
                    cands.append(derived(v))

            for item in idx["byParent"].get(x.concept, []):
                elr = item["elr"]
                code = item["code"]
                if f"{elr}|{x.concept}" in idx["soft"]:
                    continue
                pres = next((e for e in A.elrs if e.get("code") == code), None)
                if pres and not self.app.elr_status(f, pres.get("uri"), scope)["applicable"]:
                    continue
                sum_res = self.network_sum(elr, x.concept, x.period, x.dims)
                if sum_res["count"]:
                    cands.append({"value": Dec.to_string(sum_res["total"]), "decimals": sum_res["decimals"]})

            if scope == "CY" and x.period.get("type") == "instant" and roll_forward_change_of(A, x.concept):
                v = self.roll_forward_value(x.concept, x.dims)
                if v:
                    cands.append(derived(v))

            if not cands:
                return None
            return None if any(Dec.eq(Dec.parse(c["value"]), Dec.parse(x.value)) for c in cands) else cands[0]

        for _ in range(6):
            n = 0
            for x in f.all():
                if x.origin != "calculated" or x.nil or not A.is_numeric(x.concept) or self.statement_figure(x.concept, x.period, x.dims):
                    continue
                c = expected(x)
                if c is None:
                    continue
                v = c["value"]
                f.set_fact(
                    concept=x.concept,
                    period=x.period,
                    dims=x.dims,
                    value=v,
                    decimals=c["decimals"],
                    unit=x.unit,
                    origin="calculated",
                )
                self.recalc_from(x.concept, x.period, x.dims, 0, {"before": x.value, "after": v})
                changed.append({"concept": x.concept, "period": x.period, "dims": x.dims, "before": x.value, "after": v})
                n += 1
            if not n:
                break
        return changed

    refreshCalculatedCells = refresh_calculated_cells

    def refresh_derived_statements(self) -> List[Dict[str, Any]]:
        A = self.A
        f = self.filing
        changed = []
        for l in statement_note_links(A).values():
            if l.get("kind") != "sum":
                continue
            for scope in ("CY", "PY"):
                p = f.period(l["concept"], scope)
                x = f.get(l["concept"], p, []) if p else None
                if not x or x.nil or x.origin != "calculated":
                    continue
                v = self.note_value(l, scope)
                if v and not v.get("undetermined") and agrees(x, v):
                    continue
                before = x.value
                if not v or v.get("undetermined"):
                    f.remove_fact(x.key)
                    self.recalc_from(l["concept"], p, [], 0, {"before": before, "after": None})
                else:
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
                    self.recalc_from(l["concept"], p, [], 0, {"before": before, "after": total_str})
                changed.append({"concept": l["concept"], "scope": scope, "before": before, "after": f.get(l["concept"], p, []).value if f.get(l["concept"], p, []) else None})
        return changed

    refreshDerivedStatements = refresh_derived_statements

    def open_table(self, table_id: str, scope: str) -> Dict[str, Any]:
        self.app.assert_table_open(self.filing, table_id, scope)
        view = self.table_view(table_id)
        slices = table_slices(self.A, self.filing, table_id, scope, reporting_year)
        return {"view": view, "slices": slices, "status": self.app.table_status(self.filing, table_id, scope)}

    openTable = open_table

    def validate_slice(self, table_id: str, dims: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        t = self.A.table(table_id)
        nd = norm_dims(dims)
        errs = check_dimension_syntax(self.A, nd)
        t_axes = {a["axis"] for a in t.get("axes", [])}
        for d in nd:
            if d["axis"] not in t_axes:
                errs.append({"code": "dim.notInTable", "msg": f"{d['axis']} is not an axis of {t.get('hypercube')}"})
        if not nd and t.get("axes") and not total_column_allowed(self.A, table_id):
            need = unusable_default_axes(self.A, t, nd)
            errs.append({
                "code": "dim.none",
                "msg": f"At least one axis member is required — {' and '.join(n['axis'] for n in need)} must be given a member" if need else "At least one axis member is required",
            })
        if errs:
            raise DimensionError("; ".join(e["msg"] for e in errs), errs)
        return nd

    validateSlice = validate_slice

    def set_table_value(
        self,
        table_id: str,
        scope: str,
        dims: List[Dict[str, Any]],
        concept: str,
        display: Any,
        preferred_label: Optional[str] = None,
        recalc: bool = False,
        override: bool = False,
        lock_calculated: bool = False,
        unlock_py: bool = False,
        strict: bool = False,
    ) -> Any:
        if self.py_locked(scope, unlock_py):
            raise PyLockedError(PY_LOCKED)
        self.app.assert_table_open(self.filing, table_id, scope)
        t = self.A.table(table_id)
        if concept not in t.get("lineItems", []):
            raise DimensionError(f"{concept} is not a line item of {t.get('hypercube')}")
        nd = self.validate_slice(table_id, dims)
        dv = dimensionally_valid(self.A, concept, nd)
        if not dv.get("valid"):
            raise DimensionError(f"{concept} is not valid for [{dim_key(nd)}]: {dv.get('reason')}")
        st = self.app.concept_status(self.filing, concept, scope)
        if not st["applicable"]:
            raise ApplicabilityError(f"{concept} is not applicable for {scope}", st.get("reasons", []))

        calc = self.calculated_cell(concept, scope, nd, t.get("presentationElr"), preferred_label) if (lock_calculated or override) else None
        if lock_calculated and not override and calc and same_display(self, self.get_value(concept, scope, nd, preferred_label), display):
            return self.get_value(concept, scope, nd, preferred_label)
        if lock_calculated and not override and calc:
            raise CalculatedCellError(f"{self.A.label(concept)} is calculated from its child elements")

        p = self.period_for_cell(concept, scope, preferred_label)
        before = self.filing.get(concept, p, nd)
        was = before.value if before and not before.nil else None
        f = self.filing.set_display_value(concept=concept, period=p, dims=nd, display=display, strict=strict)
        if f and override and calc:
            f.origin = "override"
        if recalc:
            self.recalc_from(concept, p, nd, 0, {"before": was, "after": f.value if f and not f.nil else None})
        return f

    setTableValue = set_table_value

    def suggest_typed_value(self, table_id: str, scope: str, axis: str) -> str:
        view = self.table_view(table_id)
        ax = next((a for a in view.get("axes", []) if a["axis"] == axis), {})
        dom = ax.get("typedDomain") or axis
        prefix = dom.split(":")[1].replace("Domain", "").replace("ies", "y")
        if prefix.endswith("s"):
            prefix = prefix[:-1]
        existing = [d.get("typed") for f in self.filing.all() for d in f.dims if d.get("axis") == axis and d.get("typed") is not None]
        used = [re.match(r"^(.*?)\d+$", v).group(1) for v in existing if re.match(r"^(.*?)\d+$", v)]
        base_prefix = sorted(used)[0] if used else prefix
        return next_typed_member(existing, base_prefix)

    suggestTypedValue = suggest_typed_value

    def validate(self, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return Gate(self.A).run(self.filing, today=opts.get("today") if opts else None)

    def validate_tab(self, elr_uri: str, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        params = dict(opts or {})
        params["tab"] = elr_uri
        return Gate(self.A).run(self.filing, today=params.get("today"), tab=elr_uri)

    validateTab = validate_tab

    def export_xml(self, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return export_xml(self.A, self.filing, opts)

    exportXml = export_xml

    def preview_xml(self, text: str, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        opts = opts or {}
        try:
            res = import_instance(self.A, text, year_mode="both", file_name=opts.get("fileName", "instance.xml"))
        except CashFlowChoiceError as e:
            res = import_instance(self.A, text, year_mode="both", cash_flow_method="Indirect Method", file_name=opts.get("fileName", "instance.xml"))
            res["report"]["cashFlow"] = {**e.cash_flow, "needsChoice": True}
        rep = res["report"]
        return {
            "periods": rep.get("periodDetection"),
            "byYear": rep.get("byYear"),
            "counts": rep.get("counts"),
            "unresolved": len(rep.get("unresolvedFacts", [])),
            "errors": rep.get("errors", []),
            "cashFlow": rep.get("cashFlow"),
            "notApplicable": len(rep.get("notApplicable", [])),
        }

    previewXml = preview_xml

    def import_xml(self, text: str, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        opts = opts or {}
        res = import_instance(
            self.A,
            text,
            file_name=opts.get("fileName", "instance.xml"),
            year_mode=opts.get("yearMode", "both"),
            cash_flow_method=opts.get("cashFlowMethod"),
        )
        self.filing = res["filing"]
        self._views.clear()
        if res["report"].get("yearMode") == "next":
            self.set_meta({})
        return res["report"]

    importXml = import_xml

    def remove_facts(self, fact_list: List[Any]) -> int:
        n = 0
        for f in fact_list:
            if f.key in self.filing.facts:
                self.filing.remove_fact(f.key)
                n += 1
                if self.A.is_numeric(f.concept) and not f.nil:
                    self.recalc_from(f.concept, f.period, f.dims, 0, {"before": f.value, "after": None})
        return n

    removeFacts = remove_facts

    def py_opening_facts(self) -> List[Any]:
        return [f for f in self.filing.all() if self.filing.scope_of(f.period) == "PYO"]

    pyOpeningFacts = py_opening_facts

    def py_opening_orphans(self, gate_result: Optional[Dict[str, Any]] = None) -> List[Any]:
        g = gate_result or self.validate()
        keys = {i["factKey"] for i in g.get("issues", []) if i.get("ruleId") == "GR-1" and i.get("severity") == "ERROR" and i.get("factKey")}
        return [f for f in self.py_opening_facts() if f.key in keys]

    pyOpeningOrphans = py_opening_orphans

    def remove_py_opening_orphans(self, gate_result: Optional[Dict[str, Any]] = None) -> List[Any]:
        removed = []
        g = gate_result
        for _ in range(20):
            orphans = self.py_opening_orphans(g)
            if not orphans:
                break
            self.remove_facts(orphans)
            removed.extend(orphans)
            g = None
        return removed

    removePyOpeningOrphans = remove_py_opening_orphans

    def cell_status(self, elr_uri: str, concept: str, scope: str) -> Dict[str, Any]:
        return self.app.cell_status(self.filing, elr_uri, concept, scope)

    cellStatus = cell_status
