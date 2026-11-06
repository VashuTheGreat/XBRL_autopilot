"""Applicability engine: which ELRs, concepts, and tables apply to a filing, per scope (CY/PY).

Sources: generic rules GR-11..GR-14 (report type / previous year), table rules from the
specific-rules sheet ("table is mandatory in case ..."), and the cash-flow statement type.
This is the AUTHORITATIVE gate: the UI reads it to disable controls, and the controller
and the XML gate enforce it independently.
"""

from __future__ import annotations
import datetime
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from src.core.dimensions import tables_for_fact, nondim_allowed
from src.core.periods import reporting_year
from src.core.views import nondim_row_concepts, total_column_allowed
from src.core.derived import statement_note_links
from .expr import eval_pred

CASHFLOW: Dict[str, str] = {"100300": "Direct Method", "100400": "Indirect Method"}

_OPENING_CACHE: Dict[int, Set[str]] = {}


def opening_concepts(A: Any) -> Set[str]:
    a_id = id(A)
    if a_id in _OPENING_CACHE:
        return _OPENING_CACHE[a_id]
    s: Set[str] = set()
    for arcs in A.json.get("presentation", {}).values():
        for a in arcs:
            pref = a.get("preferredLabel") or ""
            target = a.get("to")
            c = A.concept(target)
            if pref.endswith("periodStartLabel") and c and c.get("periodType") == "instant":
                s.add(target)
    _OPENING_CACHE[a_id] = s
    return s


openingConcepts = opening_concepts


class ApplicabilityError(Exception):
    def __init__(self, msg: str, reasons: Optional[List[str]] = None):
        super().__init__(msg)
        self.reasons = reasons or []


def condition_facts(when: Any) -> Set[str]:
    facts: Set[str] = set()

    def walk(x: Any):
        if not x:
            return
        if isinstance(x, list):
            for item in x:
                walk(item)
            return
        if isinstance(x, dict):
            if isinstance(x.get("fact"), str):
                facts.add(x["fact"])
            for v in x.values():
                walk(v)

    walk(when)
    return facts


class Applicability:
    def __init__(self, A: Any):
        self.A = A

        def g(n: int) -> Dict[str, Any]:
            r = next((x for x in A.rules.get("rules", []) if x.get("id") == f"GR-{n}"), None)
            return r.get("ast", {}) if r else {}

        self.gr11: Set[str] = set(g(11).get("codes", []))
        self.gr12: Set[str] = set(g(12).get("codes", []))
        self.gr12ex: Dict[str, List[str]] = g(12).get("exceptions", {})
        self.gr13: Set[str] = set(g(13).get("allowed", []))
        self.gr14: Set[str] = set(g(14).get("codes", []))
        self.countries: Set[str] = {str(c).upper() for c in A.rules.get("countries", [])}

        self.deps: List[Dict[str, Any]] = A.rules.get("booleanDependencies", [])
        self.deps_by_child: Dict[str, List[Dict[str, Any]]] = {}
        for d in self.deps:
            for c in d.get("childConcepts", []):
                self.deps_by_child.setdefault(c, []).append(d)

        self._sum_links: Optional[Dict[str, List[Dict[str, Any]]]] = None
        self._circ: Dict[str, bool] = {}

    def dependency_status(self, filing: Any, concept: str, scope: str) -> Dict[str, Any]:
        reasons = []
        for d in self.deps_by_child.get(concept, []):
            parent_concept = d.get("parentConcept")
            v = filing.value(parent_concept, scope, [])
            if v is None:
                continue
            is_true = str(v).lower() == "true"
            cond = bool(d.get("condition"))
            if is_true != cond:
                ans_str = "Yes" if is_true else "No"
                req_str = "Yes" if cond else "No"
                rules_str = ", ".join(d.get("rules", []))
                reasons.append(
                    f"DEP: '{self.A.label(parent_concept)}' is {ans_str} — applies only when {req_str} ({rules_str})"
                )

        if reasons and self.imported_content(filing, concept, scope):
            return {"applicable": True, "reasons": [], "keptUnderOtherAnswer": reasons}
        return {"applicable": len(reasons) == 0, "reasons": reasons}

    def imported_content(self, filing: Any, concept: str, scope: str) -> bool:
        for f in filing.facts_of(concept):
            if f.nil:
                continue
            if f.origin not in ("import", "edited"):
                continue
            if reporting_year(filing.meta.get("periods", {}), f.period) != scope:
                continue
            val_str = str(f.value)
            if val_str in ("0", "false"):
                continue
            if self.A.is_numeric(concept) and val_str.replace(".", "").replace("-", "").strip("0") == "":
                continue
            cleaned = val_str.replace("&nbsp;", "").strip()
            if cleaned:
                return True
        return False

    def env(self, filing: Any, scope: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        base = {
            "filing": filing,
            "A": self.A,
            "scope": scope,
            "dims": [],
            "today": datetime.date.today().isoformat(),
            "countries": self.countries,
        }
        if extra:
            base.update(extra)
        return base

    def cash_flow_type(self, filing: Any) -> Optional[str]:
        q = self.A.qname_of_local("TypeOfCashFlowStatement")
        return filing.value(q, "CY", [])

    def elr_status(self, filing: Any, elr_uri: str, scope: str) -> Dict[str, Any]:
        e = self.A.elr(elr_uri)
        if not e:
            return {"applicable": False, "reasons": ["Unknown ELR"]}
        code = (e.get("code") or "")[:6]
        reasons = []
        rt = filing.meta.get("reportType")
        if rt == "Consolidated" and code in self.gr11:
            reasons.append(f"GR-11: [{code}] not applicable to a consolidated instance")
        if rt == "Standalone" and code in self.gr14:
            reasons.append(f"GR-14: [{code}] not applicable to a standalone instance")
        if scope != "CY" and code in self.gr12:
            reasons.append(f"GR-12: [{code}] not applicable for the previous year")
        if scope != "CY" and filing.meta.get("firstFinancialYear"):
            reasons.append("First financial year: no previous-year figures")
        if code in CASHFLOW:
            t = self.cash_flow_type(filing)
            if t and t != CASHFLOW[code]:
                reasons.append(f"TypeOfCashFlowStatement is '{t}'")

        partial = self.gr12ex.get(code) if scope != "CY" else None
        return {
            "applicable": len(reasons) == 0,
            "reasons": reasons,
            "partialExceptions": partial,
        }

    elrStatus = elr_status

    def concept_status(self, filing: Any, concept: str, scope: str) -> Dict[str, Any]:
        elrs = self.A.concept_elrs(concept)
        if not elrs:
            return {"applicable": True, "reasons": []}
        c = self.A.concept(concept)
        local_name = c.get("name") if c else ""
        reasons = []

        for uri in elrs:
            st = self.elr_status(filing, uri, scope)
            e = self.A.elr(uri)
            code = (e.get("code") or "")[:6] if e else ""
            ok = st["applicable"]

            if not ok and scope != "CY" and not filing.meta.get("firstFinancialYear"):
                if all(r.startswith("GR-12") for r in st["reasons"]):
                    if local_name in self.gr12ex.get(code, []):
                        ok = True

            if ok and filing.meta.get("reportType") == "Consolidated" and code == "400100":
                if local_name not in self.gr13:
                    ok = False
                    st["reasons"].append(f"GR-13: '{local_name}' not applicable in a consolidated instance")

            if ok:
                return self.dependency_status(filing, concept, scope)
            reasons.extend(st["reasons"])

        return {"applicable": False, "reasons": list(dict.fromkeys(reasons))}

    conceptStatus = concept_status

    def cell_status(self, filing: Any, elr_uri: str, concept: str, scope: str) -> Dict[str, Any]:
        st = self.elr_status(filing, elr_uri, scope)
        if not st["applicable"]:
            e = self.A.elr(elr_uri)
            code = (e.get("code") or "")[:6] if e else ""
            c = self.A.concept(concept)
            local_name = c.get("name") if c else ""
            gr12_only = (
                scope != "CY"
                and not filing.meta.get("firstFinancialYear")
                and all(r.startswith("GR-12") for r in st["reasons"])
                and (local_name in self.gr12ex.get(code, []))
            )
            if not gr12_only:
                return {"applicable": False, "reasons": st["reasons"]}
        return self.concept_status(filing, concept, scope)

    cellStatus = cell_status

    def plan_facts(self, filing: Any) -> Dict[str, List[Any]]:
        emit = []
        excluded = []
        p_dict = filing.meta.get("periods", {})
        opening = opening_concepts(self.A) if filing.meta.get("yearMode") == "current" else None

        for f in filing.all():
            y = reporting_year(p_dict, f.period)
            if y not in ("CY", "PY"):
                emit.append(f)
                continue
            if opening and y == "PY" and f.period.get("type") == "instant" and f.concept in opening:
                y = "CY"

            cs = self.concept_status(filing, f.concept, y)
            if not cs["applicable"]:
                excluded.append({"fact": f, "reasons": cs["reasons"]})
                continue

            if f.dims:
                ts = tables_for_fact(self.A, f)
                if ts and not any(self.table_status(filing, t["id"], y)["applicable"] for t in ts):
                    reasons_list = []
                    for t in ts:
                        reasons_list.extend(self.table_status(filing, t["id"], y)["reasons"])
                    excluded.append({"fact": f, "reasons": reasons_list})
                    continue

                def cell_ok(t_cand: Dict[str, Any]) -> bool:
                    pres_elr = t_cand.get("presentationElr")
                    return not pres_elr or self.cell_status(filing, pres_elr, f.concept, y)["applicable"]

                if ts and not any(self.table_status(filing, t["id"], y)["applicable"] and cell_ok(t) for t in ts):
                    t0 = next((t for t in ts if self.table_status(filing, t["id"], y)["applicable"]), ts[0])
                    pres_elr = t0.get("presentationElr")
                    reasons_list = self.cell_status(filing, pres_elr, f.concept, y)["reasons"] if pres_elr else []
                    excluded.append({"fact": f, "reasons": reasons_list})
                    continue

            emit.append(f)

        return {"emit": emit, "excluded": excluded}

    planFacts = plan_facts

    def table_status(self, filing: Any, table_id: str, scope: str) -> Dict[str, Any]:
        t = self.A.table(table_id)
        if not t:
            return {"applicable": False, "reasons": ["Unknown table"]}
        pres_elr = t.get("presentationElr")
        if pres_elr:
            st = self.elr_status(filing, pres_elr, scope)
            if not st["applicable"]:
                ex = st.get("partialExceptions") or []
                all_gr12 = all(r.startswith("GR-12") for r in st["reasons"])
                has_ex = any(
                    self.A.concept(q) and self.A.concept(q).get("name") in ex
                    for q in t.get("lineItems", [])
                )
                if not (all_gr12 and has_ex):
                    return {"applicable": False, "reasons": st["reasons"]}

        conds = self.A.rules.get("tableApplicability", {}).get(table_id, [])
        bonds = next(
            (
                r
                for r in self.A.rules.get("rules", [])
                if r.get("status") == "EXECUTABLE"
                and r.get("ast", {}).get("type") == "tableIffMembers"
                and table_id in r.get("ast", {}).get("tables", [])
            ),
            None,
        )

        if not conds and not bonds:
            return {"applicable": True, "reasons": [], "conditional": False}

        env = self.env(filing, scope)
        met = []
        unmet = []
        open_list = []

        for c in conds:
            v = eval_pred(c.get("when"), env)
            if v is True:
                met.append(f"{c.get('rule')}: condition met")
            elif self.circular(table_id, c.get("when")) and self.table_has_own_data(filing, t, scope):
                met.append(f"{c.get('rule')}: condition depends on this table's own values, which are entered")
            elif self.derived_from_table(table_id, c.get("when")) and (
                v is None or self.condition_facts_derived(filing, c.get("when"), scope)
            ):
                open_list.append(
                    f"{c.get('rule')}: the balance-sheet figure is taken from this table — enter the table to derive it"
                )
            elif self.total_needed(filing, table_id, scope):
                open_list.append(
                    f"{c.get('rule')}: not mandatory — open because {self.total_needed(filing, table_id, scope)}"
                )
            else:
                unmet.append(
                    f"{c.get('rule')}: {'condition not determinable (fact not entered)' if v is None else 'condition false'}"
                )

        if bonds:
            ast = bonds.get("ast", {})
            has = self.members_have_data(filing, scope, ast.get("otherTables", []), ast.get("axis"), ast.get("members", []))
            target_list = met if has else unmet
            msg = (
                f"{bonds.get('id')}: Bonds/Debentures borrowings reported"
                if has
                else f"{bonds.get('id')}: no BondsMember/DebenturesMember borrowings reported"
            )
            target_list.append(msg)

        if met:
            return {"applicable": True, "mandatory": True, "conditional": True, "reasons": met}
        if open_list:
            return {"applicable": True, "mandatory": False, "conditional": True, "reasons": open_list}
        return {"applicable": False, "conditional": True, "reasons": unmet}

    tableStatus = table_status

    def total_needed(self, filing: Any, table_id: str, scope: str) -> Optional[str]:
        if self._sum_links is None:
            self._sum_links = {}
            for r in self.A.rules.get("rules", []):
                a = r.get("ast", {})
                if (
                    r.get("status") != "EXECUTABLE"
                    or a.get("type") != "eachFact"
                    or a.get("assert", {}).get("op") != "cmp"
                    or a.get("assert", {}).get("cmp") != "=="
                ):
                    continue
                assert_dict = a.get("assert", {})
                side = assert_dict.get("r", {}).get("sumAxis") or assert_dict.get("l", {}).get("sumAxis")
                if not side:
                    continue
                for t in self.A.tables:
                    if side.get("concept") in t.get("lineItems", []) and any(x.get("axis") == side.get("axis") for x in t.get("axes", [])):
                        self._sum_links.setdefault(t.get("id"), []).append(
                            {"rule": r.get("id"), "amount": a.get("concept")}
                        )

        for l in self._sum_links.get(table_id, []):
            amt = l.get("amount")
            p = filing.period(amt, scope)
            x = filing.get(amt, p, []) if p else None
            if x and not x.nil and self.concept_status(filing, amt, scope)["applicable"]:
                c = self.A.concept(amt)
                name = c.get("name") if c else amt
                return f"{name} is reported and must equal this table's total ({l.get('rule')})"
        return None

    totalNeeded = total_needed

    def derived_from_table(self, table_id: str, when: Any) -> bool:
        facts = condition_facts(when)
        links = statement_note_links(self.A)
        return len(facts) > 0 and all(links.get(q, {}).get("tableId") == table_id for q in facts)

    derivedFromTable = derived_from_table

    def condition_facts_derived(self, filing: Any, when: Any, scope: str) -> bool:
        for q in condition_facts(when):
            p = filing.period(q, scope)
            x = filing.get(q, p, []) if p else None
            if not x or x.nil or x.origin == "calculated":
                return True
        return False

    conditionFactsDerived = condition_facts_derived

    def circular(self, table_id: str, when: Any) -> bool:
        k = f"{table_id}{when}"
        if k in self._circ:
            return self._circ[k]
        facts = condition_facts(when)
        t = self.A.table(table_id)
        items = set(t.get("lineItems", [])) if t else set()
        r = False
        for arcs in self.A.json.get("calculation", {}).values():
            for a in arcs:
                if a.get("from") in facts and a.get("to") in items:
                    r = True
                    break
        if total_column_allowed(self.A, table_id) and any(q in items and nondim_allowed(self.A, q) for q in facts):
            r = True
        self._circ[k] = r
        return r

    def table_has_own_data(self, filing: Any, t: Dict[str, Any], scope: str) -> bool:
        items = set(t.get("lineItems", []))
        axes = {a["axis"] for a in t.get("axes", [])}
        rows = nondim_row_concepts(self.A)
        for f in filing.all():
            if f.concept in items and not f.nil and all(d["axis"] in axes for d in f.dims):
                if reporting_year(filing.meta.get("periods", {}), f.period) == scope:
                    if len(f.dims) > 0 or f.concept not in rows:
                        return True
        return False

    tableHasOwnData = table_has_own_data

    def members_have_data(self, filing: Any, scope: str, table_ids: List[str], axis: str, members: List[str]) -> bool:
        tables = [self.A.table(tid) for tid in table_ids if self.A.table(tid)]
        line_items = {q for t in tables for q in t.get("lineItems", [])}
        for f in filing.all():
            if f.concept in line_items and filing.scope_of(f.period) == scope and not f.nil:
                if any(d.get("axis") == axis and d.get("member") in members for d in f.dims):
                    return True
        return False

    membersHaveData = members_have_data

    def assert_table_open(self, filing: Any, table_id: str, scope: str) -> Dict[str, Any]:
        st = self.table_status(filing, table_id, scope)
        if not st["applicable"]:
            raise ApplicabilityError(f"Table {table_id} is not applicable for {scope}", st["reasons"])
        return st

    assertTableOpen = assert_table_open
