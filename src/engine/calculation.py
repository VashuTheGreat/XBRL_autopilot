"""Calculation engine — derived exclusively from the taxonomy calculation linkbase.

Each calculation ELR is evaluated on its own (no merging of trees across ELRs).
For every reported parent fact, children are taken from the same context (period + dimensions).
Consistency (XBRL Calculations 1.1, round-to-nearest):
  Sigma(child * weight) is computed from the reported (unrounded) child values and
  compared with the parent after rounding both to the lowest `decimals` among the participating facts.
"""

from __future__ import annotations
from typing import Any, Callable, Dict, List, Optional
from src.core import decimal as Dec


class CalcStatus:
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


def min_decimals(facts: List[Any]) -> float:
    m = float("inf")
    for f in facts:
        dec_val = getattr(f, "decimals", None)
        if dec_val in ("INF", None):
            d = float("inf")
        else:
            try:
                d = float(dec_val)
            except (ValueError, TypeError):
                d = float("inf")
        if d < m:
            m = d
    return m


minDecimals = min_decimals


def ctx_of(f: Any) -> str:
    p = f.period
    period_str = p.get("date", "") if p.get("type") == "instant" else f"{p.get('start', '')}/{p.get('end', '')}"
    dims_str = "|".join(f"{d['axis']}={d.get('member') or d.get('typed')}" for d in f.dims)
    return f"{period_str}#{dims_str}"


ctxOf = ctx_of


def calculation_networks(A: Any) -> List[Dict[str, Any]]:
    nets = []
    for elr, arcs in A.json.get("calculation", {}).items():
        by_parent: Dict[str, List[Any]] = {}
        for a in arcs:
            by_parent.setdefault(a["from"], []).append(a)
        for parent, children in by_parent.items():
            children.sort(key=lambda x: x.get("order", 0))
            nets.append({"elr": elr, "parent": parent, "children": children})
    return nets


calculationNetworks = calculation_networks


def run_calculations(
    A: Any,
    filing: Any,
    is_elr_applicable: Callable[[str], bool] = lambda elr: True,
) -> List[Dict[str, Any]]:
    results = []
    index: Dict[str, Any] = {}
    for f in filing.all():
        k = f"{f.concept}#{ctx_of(f)}"
        index[k] = f

    for net in calculation_networks(A):
        parent_facts = [f for f in filing.facts_of(net["parent"]) if not f.nil]
        for pf in parent_facts:
            ctx = ctx_of(pf)
            base: Dict[str, Any] = {
                "elr": net["elr"],
                "parent": net["parent"],
                "period": pf.period,
                "dims": pf.dims,
                "factKey": pf.key,
            }

            if not is_elr_applicable(net["elr"]):
                results.append({**base, "status": CalcStatus.NOT_APPLICABLE})
                continue

            kids = []
            for a in net["children"]:
                cf = index.get(f"{a['to']}#{ctx}")
                if cf and not cf.nil:
                    kids.append({"fact": cf, "weight": a.get("weight", 1)})

            if not kids:
                results.append({**base, "status": CalcStatus.INSUFFICIENT_DATA, "children": []})
                continue

            d = min_decimals([pf] + [k["fact"] for k in kids])
            dec_arg = "INF" if d == float("inf") else int(d)

            def round_val(v: Any) -> Dec.Dec:
                return Dec.round_dec(Dec.parse(v), dec_arg)

            kids_sum = Dec.ZERO
            for k in kids:
                prod = Dec.mul(Dec.parse(k["fact"].value), Dec.parse(str(k["weight"])))
                kids_sum = Dec.add(kids_sum, prod)

            total = round_val(Dec.to_string(kids_sum))
            pv = round_val(pf.value)
            ok = Dec.eq(total, pv)

            results.append(
                {
                    **base,
                    "status": CalcStatus.PASS if ok else CalcStatus.FAIL,
                    "reported": Dec.to_string(pv),
                    "computed": Dec.to_string(total),
                    "decimals": dec_arg,
                    "children": [
                        {"concept": k["fact"].concept, "value": k["fact"].value, "weight": k["weight"]}
                        for k in kids
                    ],
                    "missingChildren": [
                        a["to"] for a in net["children"] if not any(k["fact"].concept == a["to"] for k in kids)
                    ],
                }
            )

    return results


runCalculations = run_calculations
