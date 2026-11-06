"""Business-rule engine: executes every EXECUTABLE rule of the compiled MCA corpus.

Rule results: PASS | FAIL | WARN | NOT_APPLICABLE | REVIEW_ONLY_EXTERNAL_DATA | UNIMPLEMENTED | APPROVED_LIMITATION_NOT_EXECUTED.
No rule is ever reported PASS unless it was actually evaluated.
"""

from __future__ import annotations
import datetime
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from src.core import decimal as Dec
from src.core.dimensions import dimensionally_valid, sequential_gaps, tables_for_fact
from src.core.model import dim_key
from src.core.periods import reporting_year, scope_of
from .applicability import Applicability
from .calculation import run_calculations, CalcStatus
from .expr import eval_pred, eval_expr

_SINGLE_MEMBER_CACHE: Dict[int, Set[str]] = {}


def single_member_tables(A: Any) -> Set[str]:
    a_id = id(A)
    if a_id in _SINGLE_MEMBER_CACHE:
        return _SINGLE_MEMBER_CACHE[a_id]
    s: Set[str] = set()
    for r in A.rules.get("rules", []):
        if r.get("status") == "EXECUTABLE":
            ast = r.get("ast", {})
            if ast.get("type") == "lineItemSingleMember":
                for tid in ast.get("tables", []):
                    s.add(tid)
    _SINGLE_MEMBER_CACHE[a_id] = s
    return s


def gr3_required_parent(A: Any, axis: str, member: str, table_names: List[str]) -> Optional[str]:
    info = A.axis_info(axis)
    parent = info.get("parents", {}).get(member) if info else None
    if not parent or parent == A.dimension_default(axis):
        return None
    if info.get("members", {}).get(parent, {}).get("usable") is False:
        return None
    exemptions = A.rules.get("exemptions", {}).get("parentMember", [])
    for e in exemptions:
        if e.get("axis") == axis and e.get("member") == parent and e.get("table") in table_names:
            return None
    return parent


gr3RequiredParent = gr3_required_parent


class RuleEngine:
    def __init__(self, A: Any):
        self.A = A
        self.app = Applicability(A)
        self.rules = A.rules.get("rules", [])
        self._mandatory_concepts: Set[str] = {
            r["ast"]["concept"]
            for r in self.rules
            if r.get("status") == "EXECUTABLE"
            and r.get("ast", {}).get("type") == "mandatory"
            and not r.get("ast", {}).get("when")
        }
        self._calc_exempt: Optional[Set[str]] = None
        self.today = datetime.date.today().isoformat()

    def run(
        self,
        filing: Any,
        today: Optional[str] = None,
        only: Optional[Set[str]] = None,
    ) -> Dict[str, Any]:
        self.today = today or datetime.date.today().isoformat()
        results: List[Dict[str, Any]] = []
        executed: Dict[str, str] = {}
        ctx = {"filing": filing, "results": results, "calc": None}

        for r in self.rules:
            r_id = r.get("id")
            if only and r_id not in only:
                continue

            status = r.get("status")
            if status != "EXECUTABLE":
                if status == "UNIMPLEMENTED" and r.get("approvedLimitation"):
                    results.append(
                        {
                            "ruleId": r_id,
                            "scope": None,
                            "status": "APPROVED_LIMITATION_NOT_EXECUTED",
                            "message": f"APPROVED LIMITATION / NOT EXECUTED: {r.get('text')}",
                        }
                    )
                    executed[r_id] = "APPROVED LIMITATION / NOT EXECUTED"
                    continue
                if status in ("REVIEW_ONLY_EXTERNAL_DATA", "UNIMPLEMENTED"):
                    results.append(
                        {
                            "ruleId": r_id,
                            "scope": None,
                            "status": status,
                            "message": r.get("reason") or r.get("text"),
                        }
                    )
                executed[r_id] = status
                continue

            if not r.get("ast"):
                executed[r_id] = "EXECUTED"
                continue

            before = len(results)
            try:
                self.exec_rule(r, ctx)
            except Exception as e:
                results.append(
                    {
                        "ruleId": r_id,
                        "scope": None,
                        "status": "FAIL",
                        "message": f"Rule engine error: {e}",
                        "engineError": True,
                    }
                )
            executed[r_id] = "EXECUTED"
            if len(results) == before:
                results.append(
                    {
                        "ruleId": r_id,
                        "scope": None,
                        "status": "NOT_APPLICABLE",
                        "message": "No facts or conditions in scope",
                    }
                )

        return {"results": results, "ruleStatus": executed, "calculations": ctx["calc"]}

    def env(self, filing: Any, scope: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        params = {"today": self.today}
        if extra:
            params.update(extra)
        return self.app.env(filing, scope, params)

    def scopes(self, r: Dict[str, Any], filing: Any) -> List[str]:
        s = r.get("scope", {}).get("periods") or ["CY", "PY"]
        return [x for x in s if x == "CY" or (not filing.meta.get("firstFinancialYear") and x == "PY")]

    def facts_in(self, filing: Any, concept: str, scope: str) -> List[Any]:
        p_dict = filing.meta.get("periods", {})
        return [
            f
            for f in filing.facts_of(concept)
            if not f.nil
            and reporting_year(p_dict, f.period) == scope
            and filing.scope_of(f.period) != "PYO"
        ]

    def out(
        self,
        ctx: Dict[str, Any],
        r: Dict[str, Any],
        scope: Optional[str],
        status: str,
        message: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        extra = dict(extra or {})
        if status == "FAIL" and r.get("severity") == "WARNING":
            status = "WARN"
            message += f" — not blocking: {r.get('divergence')}"

        a = r.get("ast", {})
        if a.get("type") == "tableRequired":
            if not extra.get("tableId"):
                tables = a.get("tables", [])
                extra["tableId"] = tables[0] if tables else None
        elif "concept" not in extra and "factKey" not in extra:
            concepts = a.get("concepts", [])
            extra["concept"] = r.get("subject") or a.get("concept") or (concepts[0] if concepts else None)

        ctx["results"].append({
            "ruleId": r.get("id"),
            "scope": scope,
            "status": status,
            "message": message,
            **extra,
        })

    def label(self, q: Optional[str]) -> str:
        if not q:
            return ""
        c = self.A.concept(q)
        return (c.get("name") if c else q) or q

    def exec_rule(self, r: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        filing = ctx["filing"]
        a = r.get("ast", {})
        a_type = a.get("type")

        if a_type == "mandatory":
            return self.mandatory(r, ctx)
        if a_type in ("eachFact", "eachFactOf"):
            concept = a.get("concept")
            for scope in self.scopes(r, filing):
                for f in self.facts_in(filing, concept, scope):
                    env = self.env(filing, scope, {"self": f, "dims": f.dims})
                    if a.get("when") and eval_pred(a["when"], env) is not True:
                        continue
                    v = eval_pred(a.get("assert"), env)
                    if v is True:
                        self.out(ctx, r, scope, "PASS", r.get("text", ""), {"factKey": f.key})
                    elif v is False:
                        missing = (
                            a["assert"].get("e", {}).get("fact")
                            if a_type == "eachFactOf"
                            and a.get("assert", {}).get("op") == "entered"
                            else None
                        )
                        if missing:
                            loc = {
                                "concept": missing,
                                "dims": f.dims if dimensionally_valid(self.A, missing, f.dims).get("valid") else [],
                                "relatedFactKey": f.key,
                            }
                        else:
                            loc = {"factKey": f.key}
                        dims_str = f" [{dim_key(f.dims)}]" if f.dims else ""
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"{self.label(concept)}{dims_str}: {a.get('message') or r.get('text')}",
                            loc,
                        )
            return

        if a_type == "assert":
            for scope in self.scopes(r, filing):
                subj = r.get("subject")
                if subj and not self.app.concept_status(filing, subj, scope)["applicable"]:
                    continue
                env = self.env(filing, scope)
                if a.get("when") and eval_pred(a["when"], env) is not True:
                    continue
                v = eval_pred(a.get("assert"), env)
                if v is True:
                    self.out(ctx, r, scope, "PASS", r.get("text", ""))
                elif v is False:
                    self.out(ctx, r, scope, "FAIL", f"{self.label(subj)}: {r.get('text')}")
            return

        if a_type == "iffEntered":
            concepts = a.get("concepts", [])
            p, q = concepts[0], concepts[1]
            for scope in self.scopes(r, filing):
                ctxs: Dict[str, List[Dict[str, Any]]] = {}
                for c in concepts:
                    for f in self.facts_in(filing, c, scope):
                        ctxs[dim_key(f.dims)] = f.dims
                for dims in ctxs.values():
                    hp = filing.value(p, scope, dims) is not None
                    hq = filing.value(q, scope, dims) is not None
                    if hp and hq:
                        self.out(ctx, r, scope, "PASS", r.get("text", ""))
                    else:
                        missing_concept = q if hp else p
                        present_concept = p if hp else q
                        dims_str = f" [{dim_key(dims)}]" if dims else ""
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"{self.label(missing_concept)} is required because {self.label(present_concept)} is entered{dims_str}",
                            {"concept": missing_concept, "dims": dims},
                        )
            return

        if a_type == "memberMandatory":
            concept = a.get("concept")
            member = a.get("member")
            c_info = self.A.concept(concept)
            pt = c_info.get("periodType") if c_info else None
            p_dict = filing.meta.get("periods", {})
            for scope in self.scopes(r, filing):
                ctxs = {}
                for f in filing.all():
                    if (
                        not f.nil
                        and f.period.get("type") == pt
                        and reporting_year(p_dict, f.period) == scope
                        and any(d.get("member") == member for d in f.dims)
                    ):
                        ctxs[dim_key(f.dims)] = f.dims
                for dims in ctxs.values():
                    if not dimensionally_valid(self.A, concept, dims).get("valid"):
                        continue
                    if filing.value(concept, scope, dims) is not None:
                        self.out(ctx, r, scope, "PASS", r.get("text", ""))
                    else:
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"{self.label(concept)} is mandatory for {self.label(member)} [{dim_key(dims)}]",
                            {"concept": concept, "dims": dims},
                        )
            return

        if a_type == "tableRequired":
            tables = a.get("tables", [])
            for scope in self.scopes(r, filing):
                elr_ok = any(
                    self.app.elr_status(filing, self.A.table(t).get("presentationElr"), scope)["applicable"]
                    for t in tables
                    if self.A.table(t)
                )
                if not elr_ok:
                    continue
                v = eval_pred(a.get("when"), self.env(filing, scope))
                if v is not True:
                    continue
                has = self.table_has_data(filing, tables, scope)
                table_label = self.label(self.A.table(tables[0]).get("hypercube")) if tables else ""
                self.out(
                    ctx,
                    r,
                    scope,
                    "PASS" if has else "FAIL",
                    r.get("text", "")
                    if has
                    else f"Table {table_label} is mandatory for {scope}: {r.get('text')}",
                )
            return

        if a_type == "tableIffMembers":
            for scope in self.scopes(r, filing):
                members = self.app.members_have_data(
                    filing, scope, a.get("otherTables", []), a.get("axis"), a.get("members", [])
                )
                table = self.table_has_data(filing, a.get("tables", []), scope)
                if not members and not table:
                    continue
                ok = members == table
                msg = (
                    r.get("text", "")
                    if ok
                    else (
                        "DetailsOfBondsOrDebenturesTable is mandatory because Bonds/Debentures borrowings are reported"
                        if members
                        else "Bonds/Debentures borrowings must be reported because DetailsOfBondsOrDebenturesTable is provided"
                    )
                )
                self.out(ctx, r, scope, "PASS" if ok else "FAIL", msg)
            return

        if a_type == "groupSum":
            concept = a.get("concept")
            group_axis = a.get("groupAxis")
            group_under = a.get("groupUnder")
            limit = a.get("limit")
            for scope in self.scopes(r, filing):
                groups: Dict[str, Dec.Dec] = {}
                tol: Dict[str, Dec.Dec] = {}
                for f in self.facts_in(filing, concept, scope):
                    g = next((d for d in f.dims if d.get("axis") == group_axis), None)
                    if not g or not self.is_under(group_axis, g.get("member"), group_under):
                        continue
                    k = g.get("member")
                    groups[k] = Dec.add(groups.get(k, Dec.ZERO), Dec.parse(f.value))
                    dd = None if f.decimals in ("INF", None) else int(f.decimals)
                    if dd is not None:
                        tol[k] = Dec.add(tol.get(k, Dec.ZERO), Dec.shift(Dec.parse("5"), -(dd + 1)))

                for m, total in groups.items():
                    sub = Dec.sub(total, tol.get(m, Dec.ZERO))
                    ok = Dec.cmp(sub, Dec.parse(limit)) <= 0
                    tbl = next(
                        (
                            t
                            for t in self.A.tables_for_concept(concept)
                            if any(x.get("axis") == group_axis for x in t.get("axes", []))
                            and any(x.get("axis") == a.get("sumAxis") for x in t.get("axes", []))
                        ),
                        None,
                    )
                    extra_dict = {"tableId": tbl.get("id"), "concept": None} if tbl else {}
                    self.out(
                        ctx,
                        r,
                        scope,
                        "PASS" if ok else "FAIL",
                        r.get("text", "")
                        if ok
                        else f"Σ {self.label(concept)} for {self.label(m)} = {Dec.to_string(total)} exceeds {limit} (100%)",
                        extra_dict,
                    )
            return

        if a_type == "unique":
            tables = [self.A.table(tid) for tid in a.get("tables", []) if self.A.table(tid)]
            axes = {x["axis"] for t in tables for x in t.get("axes", [])}
            concept = a.get("concept")
            for scope in self.scopes(r, filing):
                facts = [
                    f
                    for f in self.facts_in(filing, concept, scope)
                    if not axes or (len(f.dims) > 0 and all(d["axis"] in axes for d in f.dims))
                ]
                if not facts:
                    continue
                seen_vals: Dict[str, List[Any]] = {}
                for f in facts:
                    k = str(f.value).strip().upper()
                    seen_vals.setdefault(k, []).append(f)
                dups = [fs for fs in seen_vals.values() if len(fs) > 1]
                if not dups:
                    self.out(ctx, r, scope, "PASS", r.get("text", ""))
                for fs in dups:
                    dims_list = " | ".join(dim_key(f.dims) for f in fs)
                    v_str = str(fs[0].value).strip()
                    self.out(
                        ctx,
                        r,
                        scope,
                        "FAIL",
                        f"{self.label(concept)} '{v_str}' is entered for {len(fs)} members [{dims_list}]: {r.get('text')}",
                        {"factKey": fs[1].key},
                    )
            return

        if a_type == "memberArith":
            axis = a.get("axis")
            def_member = self.A.dimension_default(axis)

            def with_member(dims: List[Dict[str, Any]], m: str) -> List[Dict[str, Any]]:
                return dims if m == def_member else dims + [{"axis": axis, "member": m}]

            concept = a.get("concept")
            for scope in self.scopes(r, filing):
                for f in self.facts_in(filing, concept, scope):
                    if not any(d.get("axis") == axis and d.get("member") == a["plus"][0] for d in f.dims):
                        continue
                    others = [d for d in f.dims if d.get("axis") != axis]

                    def val(m: str) -> Optional[Dec.Dec]:
                        v = filing.value(concept, scope, with_member(others, m))
                        return Dec.parse(v) if v is not None else None

                    target = val(a.get("target"))
                    parts = [val(m) for m in a.get("plus", [])] + [val(m) for m in a.get("minus", [])]
                    if target is None or any(x is None for x in parts):
                        continue

                    num_plus = len(a.get("plus", []))
                    plus_sum = Dec.sum_dec(parts[:num_plus])
                    minus_sum = Dec.sum_dec(parts[num_plus:])
                    computed = Dec.sub(plus_sum, minus_sum)
                    okv = Dec.eq(target, computed)
                    others_str = f" [{dim_key(others)}]" if others else ""
                    plus_str = " + ".join(self.label(m) for m in a.get("plus", []))
                    minus_str = " − ".join(self.label(m) for m in a.get("minus", []))
                    msg = (
                        r.get("text", "")
                        if okv
                        else f"{self.label(concept)}{others_str}: {self.label(a.get('target'))} {Dec.to_string(target)} ≠ {Dec.to_string(computed)} ({plus_str} − {minus_str})"
                    )
                    self.out(ctx, r, scope, "PASS" if okv else "FAIL", msg, {"factKey": f.key})
            return

        if a_type == "tableOneComplete":
            except_set = set(a.get("except", []))
            for tid in a.get("tables", []):
                t = self.A.table(tid)
                if not t:
                    continue
                for scope in self.scopes(r, filing):
                    groups = self.table_groups(filing, t, scope)
                    if not groups:
                        continue
                    ml_rules = [
                        x
                        for x in self.A.rules.get("rules", [])
                        if x.get("status") == "EXECUTABLE"
                        and x.get("ast", {}).get("type") == "lineItemsMandatory"
                        and tid in x.get("ast", {}).get("tables", [])
                    ]
                    named = (
                        {c for x in ml_rules for c in x.get("ast", {}).get("concepts", [])}
                        if ml_rules
                        else None
                    )
                    items = [
                        q
                        for q in t.get("lineItems", [])
                        if (not named or q in named)
                        and q not in except_set
                        and not getattr(self.A.concept(q), "abstract", False)
                        and self.app.concept_status(filing, q, scope)["applicable"]
                    ]

                    def is_complete(dims: List[Dict[str, Any]]) -> bool:
                        return all(
                            not dimensionally_valid(self.A, q, dims).get("valid")
                            or filing.value(q, scope, dims) is not None
                            for q in items
                        )

                    complete = any(is_complete(dims) for dims in groups.values())
                    self.out(
                        ctx,
                        r,
                        scope,
                        "PASS" if complete else "FAIL",
                        r.get("text", "")
                        if complete
                        else f"Table {self.label(t.get('hypercube'))}: no member has all details entered ({r.get('text')})",
                    )
            return

        if a_type == "lineItemSingleMember":
            for tid in a.get("tables", []):
                t = self.A.table(tid)
                if not t:
                    continue
                items = set(t.get("lineItems", []))
                axes = {x["axis"] for x in t.get("axes", [])}
                for scope in self.scopes(r, filing):
                    where: Dict[str, Set[str]] = {}
                    for f in filing.all():
                        if (
                            f.concept not in items
                            or f.nil
                            or not f.dims
                            or not all(d["axis"] in axes for d in f.dims)
                            or reporting_year(filing.meta.get("periods", {}), f.period) != scope
                        ):
                            continue
                        where.setdefault(f.concept, set()).add(dim_key(f.dims))

                    if not where:
                        continue
                    multi = [(q, ks) for q, ks in where.items() if len(ks) > 1]
                    if not multi:
                        self.out(ctx, r, scope, "PASS", r.get("text", ""))
                    for q, ks in multi:
                        first_k = sorted(ks)[0]
                        f_match = next(
                            (
                                f
                                for f in filing.all()
                                if f.concept == q
                                and not f.nil
                                and dim_key(f.dims) == first_k
                                and reporting_year(filing.meta.get("periods", {}), f.period) == scope
                            ),
                            None,
                        )
                        first_dims = f_match.dims if f_match else []
                        ks_str = " | ".join(sorted(ks))
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"{self.label(q)} is provided against {len(ks)} members [{ks_str}]: {r.get('text')}",
                            {"concept": q, "dims": first_dims, "tableId": tid},
                        )
            return

        if a_type == "cashFlowMethod":
            type_val = filing.value(a.get("concept"), "CY", [])
            if type_val is None:
                return
            other_code = {"Direct Method": "100400", "Indirect Method": "100300"}.get(type_val)
            if not other_code:
                return
            mine_code = "100300" if other_code == "100400" else "100400"
            bad = 0
            p_dict = filing.meta.get("periods", {})
            for f in filing.all():
                if f.nil:
                    continue
                codes = [self.A.elr(u).get("code", "")[:6] for u in self.A.concept_elrs(f.concept) if self.A.elr(u)]
                if other_code in codes and mine_code not in codes and all(c in (other_code, "100300", "100400") for c in codes):
                    bad += 1
                    other_name = "direct" if other_code == "100300" else "indirect"
                    self.out(
                        ctx,
                        r,
                        reporting_year(p_dict, f.period),
                        "FAIL",
                        f"'{self.label(f.concept)}' belongs only to the {other_name}-method cash flow statement but TypeOfCashFlowStatement is '{type_val}'",
                        {"factKey": f.key},
                    )
            if not bad:
                self.out(ctx, r, "CY", "PASS", r.get("text", ""))
            return

        if a_type == "lineItemsMandatory":
            return self.line_items(r, ctx)
        if a_type == "generic":
            return self.generic(r, ctx)

        raise ValueError(f"Unknown rule AST type {a_type}")

    def is_under(self, axis: str, member: str, ancestor: str) -> bool:
        m = member
        for _ in range(20):
            if not m:
                break
            if m == ancestor:
                return True
            m = self.A.member_parent(axis, m)
        return False

    def table_groups(self, filing: Any, t: Dict[str, Any], scope: str) -> Dict[str, List[Dict[str, Any]]]:
        items = set(t.get("lineItems", []))
        axes = {x["axis"] for x in t.get("axes", [])}
        groups: Dict[str, List[Dict[str, Any]]] = {}
        p_dict = filing.meta.get("periods", {})
        for f in filing.all():
            if f.concept not in items or f.nil or not f.dims or not all(d["axis"] in axes for d in f.dims):
                continue
            if reporting_year(p_dict, f.period) != scope or filing.scope_of(f.period) == "PYO":
                continue
            groups[dim_key(f.dims)] = f.dims
        return groups

    def table_has_data(self, filing: Any, table_ids: List[str], scope: str) -> bool:
        p_dict = filing.meta.get("periods", {})
        for tid in table_ids:
            t = self.A.table(tid)
            if not t:
                continue
            items = set(t.get("lineItems", []))
            axes = {x["axis"] for x in t.get("axes", [])}
            if any(
                f.concept in items
                and not f.nil
                and f.dims
                and all(d["axis"] in axes for d in f.dims)
                and reporting_year(p_dict, f.period) == scope
                for f in filing.all()
            ):
                return True
        return False

    def mandatory(self, r: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        filing = ctx["filing"]
        a = r.get("ast", {})
        concept = a.get("concept")
        p_dict = filing.meta.get("periods", {})
        for scope in self.scopes(r, filing):
            if not self.app.concept_status(filing, concept, scope)["applicable"]:
                continue
            if a.get("when"):
                if eval_pred(a["when"], self.env(filing, scope)) is not True:
                    continue
            nd = filing.value(concept, scope, []) is not None
            any_facts = nd or len(self.facts_in(filing, concept, scope)) > 0
            period_end = p_dict.get("cy", {}).get("end") if scope == "CY" else p_dict.get("py", {}).get("end")
            msg = (
                r.get("text", "")
                if any_facts
                else f"'{self.label(concept)}' is mandatory — not present for {scope} ({period_end})"
            )
            self.out(ctx, r, scope, "PASS" if any_facts else "FAIL", msg, {"concept": concept})

    def line_items(self, r: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        filing = ctx["filing"]
        a = r.get("ast", {})
        p_dict = filing.meta.get("periods", {})

        for tid in a.get("tables", []):
            t = self.A.table(tid)
            if not t:
                continue
            items = set(t.get("lineItems", []))
            axes = {x["axis"] for x in t.get("axes", [])}

            for scope in self.scopes(r, filing):
                if (
                    not self.app.table_status(filing, tid, scope)["applicable"]
                    and not self.table_has_data(filing, [tid], scope)
                ):
                    continue

                groups: Dict[str, List[Dict[str, Any]]] = {}
                for f in filing.all():
                    if f.concept not in items or f.nil or not f.dims or not all(d["axis"] in axes for d in f.dims):
                        continue
                    if not any(x.get("hypercube") == t.get("hypercube") for x in tables_for_fact(self.A, f)):
                        continue
                    if reporting_year(p_dict, f.period) != scope or filing.scope_of(f.period) == "PYO":
                        continue
                    groups[dim_key(f.dims)] = f.dims

                if groups and tid in single_member_tables(self.A):
                    cols = list(groups.values())

                    def count_col(dims: List[Dict[str, Any]]) -> int:
                        return sum(1 for q in a.get("concepts", []) if filing.value(q, scope, dims) is not None)

                    main_col = max(cols, key=count_col) if cols else []
                    missing = [
                        q
                        for q in a.get("concepts", [])
                        if self.app.concept_status(filing, q, scope)["applicable"]
                        and any(dimensionally_valid(self.A, q, dims).get("valid") for dims in cols)
                        and not any(filing.value(q, scope, dims) is not None for dims in cols)
                    ]
                    if missing:
                        loc_concept = next(
                            (q for q in missing if dimensionally_valid(self.A, q, main_col).get("valid")),
                            missing[0],
                        )
                        missing_names = ", ".join(self.label(q) for q in missing)
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"Table {self.label(t.get('hypercube'))} mandatory element(s) [{missing_names}] not present under any member for {scope} (each is required once, under one member)",
                            {"concept": loc_concept, "dims": main_col, "tableId": tid},
                        )
                    else:
                        self.out(ctx, r, scope, "PASS", r.get("text", ""))
                    continue

                for dims in groups.values():
                    missing = []
                    for q in a.get("concepts", []):
                        if not dimensionally_valid(self.A, q, dims).get("valid"):
                            continue
                        if not self.app.concept_status(filing, q, scope)["applicable"]:
                            continue
                        if filing.value(q, scope, dims) is None:
                            missing.append(self.label(q))

                    for grp in a.get("atLeastOne", []):
                        valid = [q for q in grp if dimensionally_valid(self.A, q, dims).get("valid")]
                        if valid and not any(filing.value(q, scope, dims) is not None for q in valid):
                            missing.append(f"at least one of {len(valid)} elements under the transactions abstract")

                    first_missing = next(
                        (
                            q
                            for q in a.get("concepts", [])
                            if dimensionally_valid(self.A, q, dims).get("valid")
                            and self.app.concept_status(filing, q, scope)["applicable"]
                            and filing.value(q, scope, dims) is None
                        ),
                        None,
                    )
                    if not first_missing and a.get("atLeastOne"):
                        first_missing = next(
                            (
                                q
                                for grp in a["atLeastOne"]
                                for q in grp
                                if dimensionally_valid(self.A, q, dims).get("valid")
                            ),
                            None,
                        )

                    soft = {self.label(q) for q in a.get("softConcepts", [])}
                    hard = [m for m in missing if m not in soft]

                    if missing and not hard:
                        missing_str = ", ".join(missing)
                        self.out(
                            ctx,
                            r,
                            scope,
                            "WARN",
                            f"Table {self.label(t.get('hypercube'))} element(s) [{missing_str}] not present on [{dim_key(dims)}] for {scope} — not blocking: {r.get('softEvidence')}",
                            {"concept": first_missing, "dims": dims, "tableId": tid},
                        )
                    elif missing:
                        missing_str = ", ".join(missing)
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"Table {self.label(t.get('hypercube'))} mandatory element(s) [{missing_str}] not present on [{dim_key(dims)}] for {scope}",
                            {"concept": first_missing, "dims": dims, "tableId": tid},
                        )
                    else:
                        self.out(ctx, r, scope, "PASS", r.get("text", ""))

    def calc_exemptions(self) -> Set[str]:
        if self._calc_exempt is not None:
            return self._calc_exempt
        ex: Set[str] = set()
        for e in self.A.rules.get("exemptions", {}).get("calculation", []):
            abstract = e.get("abstract")
            if abstract:
                desc: Set[str] = set()
                for uri in self.A.concept_elrs(abstract):
                    stack = [abstract]
                    while stack:
                        c = stack.pop()
                        for arc in self.A.presentation_children(uri, c):
                            desc.add(arc["to"])
                            stack.append(arc["to"])
                for q in desc:
                    if e.get("mode") != "except" or q not in e.get("concepts", []):
                        ex.add(q)
            elif e.get("mode") == "listed":
                for q in e.get("concepts", []):
                    ex.add(q)

        for q in self._mandatory_concepts:
            ex.discard(q)
        self._calc_exempt = ex
        return ex

    def generic(self, r: Dict[str, Any], ctx: Dict[str, Any]) -> None:
        filing = ctx["filing"]
        A = self.A
        h = r.get("ast", {}).get("handler")
        p_dict = filing.meta.get("periods", {})

        if h == "calc-parent-child":
            def is_elr_applicable(elr: str) -> bool:
                role = A.json.get("roles", {}).get(elr, {})
                code = (role.get("code") or "")[:6]
                pres = next((e for e in A.elrs if e.get("code") == code), None)
                return self.app.elr_status(filing, pres.get("uri"), "CY")["applicable"] if pres else True

            calc = run_calculations(A, filing, is_elr_applicable)
            ctx["calc"] = calc
            ex = self.calc_exemptions()
            reported: Set[str] = set()

            for c in calc:
                scope = reporting_year(p_dict, c["period"])
                dims_str = f" [{dim_key(c['dims'])}]" if c["dims"] else ""
                elr_def = A.json.get("roles", {}).get(c["elr"], {}).get("definition") or c["elr"]
                if c["status"] == CalcStatus.FAIL:
                    exempt = any(k["concept"] in ex for k in c["children"]) or any(q in ex for q in c["missingChildren"])
                    self.out(
                        ctx,
                        r,
                        scope,
                        "WARN" if exempt else "FAIL",
                        f"Calculation inconsistency in {elr_def}: {self.label(c['parent'])} reported {c['reported']} ≠ Σ children {c['computed']}{dims_str}",
                        {"factKey": c["factKey"], "calc": True},
                    )
                elif c["status"] == CalcStatus.INSUFFICIENT_DATA:
                    pf = filing.facts.get(c["factKey"])
                    if not pf or Dec.is_zero(Dec.parse(pf.value)):
                        continue
                    if any(
                        o["factKey"] == c["factKey"]
                        and o["status"] not in (CalcStatus.INSUFFICIENT_DATA, CalcStatus.NOT_APPLICABLE)
                        for o in calc
                    ):
                        continue
                    if c["factKey"] in reported:
                        continue
                    reported.add(c["factKey"])
                    net = [x for x in A.json.get("calculation", {}).get(c["elr"], []) if x.get("from") == c["parent"]]
                    if all(x.get("to") in ex for x in net):
                        continue
                    if not any(dimensionally_valid(A, x.get("to"), c["dims"]).get("valid") for x in net):
                        continue
                    self.out(
                        ctx,
                        r,
                        scope,
                        "FAIL",
                        f"{self.label(c['parent'])} is entered (non-zero) but none of its calculation children are entered ({elr_def}){dims_str}",
                        {"factKey": c["factKey"]},
                    )
                elif c["status"] == CalcStatus.PASS:
                    self.out(ctx, r, scope, "PASS", "calculation consistent")

            parents_of: Dict[str, List[Dict[str, str]]] = {}
            for elr, arcs in A.json.get("calculation", {}).items():
                if not is_elr_applicable(elr):
                    continue
                for a in arcs:
                    parents_of.setdefault(a["to"], []).append({"elr": elr, "parent": a["from"]})

            for f in filing.all():
                if f.nil or f.concept not in parents_of or f.concept in ex or not A.is_numeric(f.concept):
                    continue
                if Dec.is_zero(Dec.parse(f.value)):
                    continue
                ps = parents_of[f.concept]
                ok = any(
                    filing.get(p["parent"], f.period, f.dims)
                    or not dimensionally_valid(A, p["parent"], f.dims).get("valid")
                    or (A.concept(p["parent"]) and A.concept(f.concept) and A.concept(p["parent"]).get("periodType") != A.concept(f.concept).get("periodType"))
                    for p in ps
                )
                pyo = (
                    f" — a previous-year opening value (dated {f.period.get('date')}); MCA requires its total for that date as well. Previous-year opening balances are optional: clear this value, or remove every such value with Validation → Fix tools → “Remove opening values without totals”"
                    if scope_of(p_dict, f.period) == "PYO"
                    else ""
                )
                if not ok:
                    dims_str = f" [{dim_key(f.dims)}]" if f.dims else ""
                    parent_names = " / ".join(self.label(p["parent"]) for p in ps)
                    self.out(
                        ctx,
                        r,
                        reporting_year(p_dict, f.period),
                        "FAIL",
                        f"{self.label(f.concept)} is entered but its calculation parent {parent_names} is not{dims_str}{pyo}",
                        {"factKey": f.key},
                    )
            return

        if h == "mandatory-line-items-driver":
            self.out(ctx, r, None, "PASS", 'Executed through the ML-* rules (one per table in sheet "Mandatory Line Items")')
            return

        if h == "dimension-parent-child-members":
            ex_c = A.rules.get("exemptions", {}).get("childMember", [])
            excluded = set(r.get("ast", {}).get("excludedLineItems", []))
            for f in filing.all():
                if f.nil or not f.dims or f.concept in excluded:
                    continue
                tables = tables_for_fact(A, f)
                tnames = [t["hypercube"].split(":")[1] for t in tables if "hypercube" in t]
                scope = reporting_year(p_dict, f.period)

                for d in f.dims:
                    mem = d.get("member")
                    if not mem:
                        continue
                    axis = d.get("axis")
                    info = A.axis_info(axis)
                    parent = gr3_required_parent(A, axis, mem, tnames)
                    zero = A.is_numeric(f.concept) and Dec.is_decimal_string(str(f.value)) and Dec.is_zero(Dec.parse(f.value))

                    if parent and not zero:
                        pd = [dict(x, member=parent) if x.get("axis") == axis else x for x in f.dims]
                        others = [x for x in f.dims if x.get("axis") != axis]

                        def rolled_up() -> bool:
                            for g in filing.facts_of(f.concept):
                                if g.nil or g.period != f.period:
                                    continue
                                if not any(x.get("axis") == axis and x.get("member") == parent for x in g.dims):
                                    continue
                                if all(
                                    x.get("axis") == axis
                                    or any(
                                        o.get("axis") == x.get("axis")
                                        and o.get("member") == x.get("member")
                                        and o.get("typed") == x.get("typed")
                                        for o in others
                                    )
                                    for x in g.dims
                                ):
                                    return True
                            return False

                        if dimensionally_valid(A, f.concept, pd).get("valid") and not filing.get(f.concept, f.period, pd) and not rolled_up():
                            self.out(
                                ctx,
                                r,
                                scope,
                                "FAIL",
                                f"The parent member {{{self.label(parent)}}} for element '{self.label(f.concept)}' should be present for axis ({self.label(axis)}) — child {{{self.label(mem)}}} is reported",
                                {"factKey": f.key},
                            )

                    kids = [
                        m
                        for m, p in info.get("parents", {}).items()
                        if p == mem and info.get("members", {}).get(m, {}).get("usable")
                    ] if info else []

                    if kids and not any(
                        e.get("axis") == axis and e.get("member") == mem and e.get("table") in tnames
                        for e in ex_c
                    ):
                        any_kid = any(
                            filing.get(
                                f.concept,
                                f.period,
                                [dict(x, member=k) if x.get("axis") == axis else x for x in f.dims],
                            )
                            for k in kids
                        )
                        kid_valid = any(
                            dimensionally_valid(
                                A,
                                f.concept,
                                [dict(x, member=k) if x.get("axis") == axis else x for x in f.dims],
                            ).get("valid")
                            for k in kids
                        )
                        if not any_kid and kid_valid:
                            self.out(
                                ctx,
                                r,
                                scope,
                                "FAIL",
                                f"At least one child member of {{{self.label(mem)}}} should be present for element '{self.label(f.concept)}' on axis ({self.label(axis)})",
                                {"factKey": f.key},
                            )
            return

        if h == "sequential-members":
            groups: Dict[str, Set[str]] = {}
            for f in filing.all():
                for d in f.dims:
                    mem = d.get("member")
                    if not mem:
                        continue
                    k = f"{d['axis']}|{reporting_year(p_dict, f.period)}"
                    groups.setdefault(k, set()).add(mem.split(":")[1])

            for k, vals in groups.items():
                axis, scope = k.split("|")
                gaps = sequential_gaps(list(vals))
                if gaps:
                    for g in gaps:
                        self.out(
                            ctx,
                            r,
                            scope,
                            "FAIL",
                            f"Members on ({self.label(axis)}) are not sequential: {g['prefix']}{g['missing']} missing while {g['prefix']}{g['max']} is provided",
                        )
                else:
                    self.out(ctx, r, scope, "PASS", "sequential")
            return

        if h == "no-images":
            for f in filing.all():
                if not f.nil and not A.is_numeric(f.concept):
                    if re.search(r"<img\b|data:image\/|<svg\b|<object\b|<embed\b", str(f.value), re.IGNORECASE):
                        self.out(
                            ctx,
                            r,
                            reporting_year(p_dict, f.period),
                            "FAIL",
                            f"Images/charts are not allowed ({self.label(f.concept)})",
                            {"factKey": f.key},
                        )
            return

        if h == "cy-py-pairing":
            if filing.meta.get("firstFinancialYear"):
                self.out(ctx, r, None, "NOT_APPLICABLE", "First financial year")
                return
            exempt_elr = set(r.get("ast", {}).get("exemptElrCodes", []))
            for f in filing.all():
                if f.nil or not A.is_monetary(f.concept):
                    continue
                scope = filing.scope_of(f.period)
                if scope not in ("CY", "PY"):
                    continue
                elrs = [A.elr(u).get("code", "")[:6] for u in A.concept_elrs(f.concept) if A.elr(u)]
                if elrs and all(c in exempt_elr for c in elrs):
                    continue
                if f.dims:
                    continue
                other = "PY" if scope == "CY" else "CY"
                if not self.app.concept_status(filing, f.concept, other)["applicable"]:
                    continue
                op = filing.period(f.concept, other)
                if not filing.get(f.concept, op, f.dims):
                    curr_prev = "current" if scope == "CY" else "previous"
                    other_prev = "current" if other == "CY" else "previous"
                    dims_str = f" [{dim_key(f.dims)}]" if f.dims else ""
                    self.out(
                        ctx,
                        r,
                        scope,
                        "FAIL",
                        f"Since '{self.label(f.concept)}' is entered for the {curr_prev} year, the corresponding {other_prev}-year value should be entered{dims_str}",
                        {"factKey": f.key, "locateMissing": {"concept": f.concept, "scope": other}},
                    )
            return

        if h == "opening-equals-prior-closing":
            self.out(ctx, r, None, "PASS", "Structural: CY opening and PY closing balances share one instant context in the filing model")
            return

        if h == "monetary-max-2-decimals":
            for f in filing.all():
                if f.nil or not A.is_monetary(f.concept):
                    continue
                fd = Dec.fraction_digits(Dec.parse(f.value))
                if fd > 2 or (f.decimals != "INF" and f.decimals is not None and int(f.decimals) > 2):
                    self.out(
                        ctx,
                        r,
                        reporting_year(p_dict, f.period),
                        "FAIL",
                        f"'{self.label(f.concept)}' has more than 2 decimal places",
                        {"factKey": f.key},
                    )
            return

        if h == "inr-currency":
            exempt_tables = set(r.get("ast", {}).get("exemptTables", []))
            for f in filing.all():
                if f.nil or not A.is_monetary(f.concept) or f.unit == "INR":
                    continue
                if any(t.get("id") in exempt_tables for t in tables_for_fact(A, f)):
                    continue
                self.out(
                    ctx,
                    r,
                    reporting_year(p_dict, f.period),
                    "FAIL",
                    f"Reporting currency should be INR for '{self.label(f.concept)}' (unit {f.unit})",
                    {"factKey": f.key},
                )
            return

        if h in ("elr-not-for-consolidated", "elr-not-for-prior-year", "elr-not-for-standalone", "general-info-consolidated"):
            for f in filing.all():
                scope = reporting_year(p_dict, f.period)
                if scope not in ("CY", "PY"):
                    continue
                st = self.app.concept_status(filing, f.concept, scope)
                if st["applicable"]:
                    continue
                tag = {
                    "elr-not-for-consolidated": "GR-11",
                    "elr-not-for-prior-year": "GR-12",
                    "elr-not-for-standalone": "GR-14",
                    "general-info-consolidated": "GR-13",
                }[h]
                mine = [x for x in st["reasons"] if x.startswith(tag)]
                total_gr = [x for x in st["reasons"] if re.match(r"^GR-1[1-4]", x)]
                if mine and len(mine) == len(total_gr):
                    self.out(
                        ctx,
                        r,
                        scope,
                        "FAIL",
                        f"'{self.label(f.concept)}' must not be reported: {'; '.join(mine)}",
                        {"factKey": f.key},
                    )
            if h == "general-info-consolidated":
                self.out(
                    ctx,
                    r,
                    None,
                    "REVIEW_ONLY_EXTERNAL_DATA",
                    "Equality of general-information values between the standalone and consolidated instance documents requires the other instance document",
                )
            return

        if h == "mandatory-axes":
            for tname, axes_local in r.get("ast", {}).get("tables", {}).items():
                for t in [x for x in A.tables if x.get("hypercube", "").split(":")[1] == tname]:
                    items = set(t.get("lineItems", []))
                    t_axes = {x["axis"] for x in t.get("axes", [])}
                    for f in filing.all():
                        if f.concept not in items or not f.dims or not all(d["axis"] in t_axes for d in f.dims):
                            continue
                        for al in axes_local:
                            ax = A.qname_of_local(al)
                            def_member = A.dimension_default(ax)
                            ax_obj = next((x for x in t.get("axes", []) if x.get("axis") == ax), None)
                            def_ok = (
                                def_member
                                and ax_obj
                                and any(m.get("member") == def_member and m.get("usable") for m in ax_obj.get("members", []))
                            ) or (def_member and dimensionally_valid(A, f.concept, f.dims).get("valid"))
                            if not any(d.get("axis") == ax for d in f.dims) and not def_ok:
                                self.out(
                                    ctx,
                                    r,
                                    reporting_year(p_dict, f.period),
                                    "FAIL",
                                    f"Axis ({al}) is mandatory for table {tname}",
                                    {"factKey": f.key},
                                )
            return

        if h == "taxonomy-period-applicability":
            start = p_dict.get("cy", {}).get("start", "")
            if not start:
                return
            from_date = r.get("ast", {}).get("from", "")
            ok = start >= from_date
            msg = (
                "C&I Taxonomy 2016 applies"
                if ok
                else f"C&I Taxonomy 2016 applies only to financial years commencing on or after {from_date}"
            )
            self.out(ctx, r, "CY", "PASS" if ok else "FAIL", msg)
            return

        raise ValueError(f"No generic handler {h}")
