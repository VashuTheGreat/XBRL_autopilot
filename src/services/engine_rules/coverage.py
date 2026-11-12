"""Descriptions for the coverage ledger: condition text, operator, operands, and the test suite per family."""
from __future__ import annotations

import json
from typing import Any

# test references (suite files that exercise each implementation family)
TESTS = {
    "mandatory": "test/rules.test.mjs#mandatory", "gte0": "test/rules.test.mjs#sign", "gt0": "test/rules.test.mjs#sign", "lte100pct": "test/rules.test.mjs#sign",
    "lte-today": "test/rules.test.mjs#dates", "lte-ref": "test/rules.test.mjs#compare", "eq-product": "test/rules.test.mjs#compare", "eq-ref": "test/rules.test.mjs#compare",
    "mandatory-consolidated": "test/rules.test.mjs#reportType", "mandatory-standalone": "test/rules.test.mjs#reportType", "mandatory-if-yes": "test/rules.test.mjs#conditional",
    "mandatory-if-entered": "test/rules.test.mjs#conditional", "mandatory-iff-entered": "test/rules.test.mjs#conditional", "amount-number-pair": "test/rules.test.mjs#conditional",
    "continuing-default": "test/rules.test.mjs#conditional", "mandatory-for-member": "test/rules.test.mjs#member", "mandatory-if-gt0": "test/rules.test.mjs#conditional", "mandatory-if-ne0": "test/rules.test.mjs#conditional",
    "format-cin": "test/rules.test.mjs#formats", "format-pan": "test/rules.test.mjs#formats", "format-country": "test/rules.test.mjs#formats",
    "table-if-gt0": "test/applicability.test.mjs", "table-if-any": "test/applicability.test.mjs", "table-if-ne0": "test/applicability.test.mjs", "table-if-yes": "test/applicability.test.mjs",
    "bonds-debentures-iff": "test/rules.test.mjs#tables", "sharecapital-lte-subscribed": "test/rules.test.mjs#sums", "sharecapital-classes-sum": "test/rules.test.mjs#sums", "reserves-first-level": "test/rules.test.mjs#sums",
    "borrowings-first-level": "test/rules.test.mjs#sums", "typed-members-sum": "test/rules.test.mjs#sums", "sum-two-eq": "test/rules.test.mjs#sums", "provisions-term-sum": "test/rules.test.mjs#sums", "loansandadvances-term-sum": "test/rules.test.mjs#sums",
    "shareholder-cin-or-pan": "test/rules.test.mjs#formats", "shareholders-lte-paidup": "test/rules.test.mjs#sums", "shareholding-pct-lte-100": "test/rules.test.mjs#sums", "private-placement-persons": "test/rules.test.mjs#conditional", "public-offering-yes": "test/rules.test.mjs#conditional",
    "change-date-mandatory": "test/rules.test.mjs#change", "mandatory-line-items": "test/rules.test.mjs#lineItems",
    "mandatory-line-items-list": "test/rules.test.mjs#lineItems", "mandatory-line-items-all": "test/rules.test.mjs#lineItems", "mandatory-line-items-all-except": "test/rules.test.mjs#lineItems",
    "calc-parent-child": "test/calculation.test.mjs", "mandatory-line-items-driver": "test/rules.test.mjs#lineItems", "dimension-parent-child-members": "test/rules.test.mjs#generic",
    "sequential-members": "test/typed.test.mjs", "no-images": "test/rules.test.mjs#generic", "cy-py-pairing": "test/rules.test.mjs#generic", "opening-equals-prior-closing": "test/periods.test.mjs",
    "monetary-max-2-decimals": "test/rules.test.mjs#generic", "inr-currency": "test/rules.test.mjs#generic", "elr-not-for-consolidated": "test/applicability.test.mjs", "elr-not-for-prior-year": "test/applicability.test.mjs",
    "general-info-consolidated": "test/applicability.test.mjs", "elr-not-for-standalone": "test/applicability.test.mjs", "mandatory-axes": "test/rules.test.mjs#generic", "taxonomy-period-applicability": "test/rules.test.mjs#generic",
    "exempt-parent-member": "test/rules.test.mjs#generic", "exempt-child-member": "test/rules.test.mjs#generic", "exempt-calculation": "test/calculation.test.mjs",
}


def test_of(rule: dict) -> str | None:
    impl = rule.get("implementation")
    parts = impl.split(":") if isinstance(impl, str) else []
    t = TESTS.get(parts[1]) if len(parts) > 1 else None
    t = t or TESTS.get(rule["family"])
    if not t and rule["status"] == "EXECUTABLE" and rule.get("ast"):
        t = "rule-families.test.mjs"
    return t.removeprefix("test/") if t else None


def _js(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def describe(p: Any) -> str | None:
    if not p:
        return None
    op = p.get("op")
    if op == "cmp":
        return f"{dx(p['l'])} {p['cmp']} {dx(p['r'])}"
    if op in ("and", "or"):
        return f" {op.upper()} ".join(describe(a) for a in p["args"])
    if op == "not":
        return f"NOT {describe(p['arg'])}"
    if op == "entered":
        return f"entered({dx(p['e'])})"
    if op == "reportType":
        return f"reportType = {p['value']}"
    if op == "format":
        return f"{p['format']}({dx(p['e'])})"
    if op == "anyFact":
        return f"any {p['concept']} where {describe(p['pred'])}"
    if op == "existsFact":
        return f"exists {p['concept']} where {describe(p['pred'])}"
    if op == "iff":
        return f"({describe(p['args'][0])}) IFF ({describe(p['args'][1])})"
    if op == "notInFacts":
        return f"{dx(p['e'])} not in {p['concept']}"
    if op == "hasMember":
        return f"member = {p['member']}"
    if op == "tableData":
        return f"data in {', '.join(p['tables'])}"
    if op == "memberHasData":
        return f"{p['member']} reported in {', '.join(p['tables'])}"
    return op


def dx(e: Any) -> str:
    if not e:
        return "?"
    if e.get("self"):
        return "$self"
    if e.get("fact"):
        return e["fact"] + ("[no-dim]" if e.get("ctx") == "nondim" else "") + (f"[{e['scope']}]" if e.get("scope") else "")
    if "const" in e:
        return _js(e["const"])
    if e.get("mul"):
        return " × ".join(dx(x) for x in e["mul"])
    if e.get("add"):
        return " + ".join(dx(x) for x in e["add"])
    if e.get("today"):
        return "today"
    if e.get("upper"):
        return f"upper({dx(e['upper'])})"
    if e.get("sumAxis"):
        s = e["sumAxis"]
        return f"Σ {s['concept']} over {s['axis']} ({s['level']})"
    if e.get("avgAxis"):
        return f"avg {e['avgAxis']['concept']} over {e['avgAxis']['axis']}"
    if e.get("maxFacts"):
        return f"latest({', '.join('' if q is None else q for q in e['maxFacts'])})"
    if e.get("addMonths"):
        return f"{dx(e['addMonths']['e'])} + {e['addMonths']['n']} months"
    if e.get("addDays"):
        return f"{dx(e['addDays']['e'])} + {e['addDays']['n']} days"
    return _js(e)


def op_of(ast: dict) -> str:
    if ast["type"] in ("eachFact", "assert", "eachFactOf"):
        a = ast.get("assert")
        if a and a.get("op") == "cmp":
            return a["cmp"]
        return (a or {}).get("op") or ast["type"]
    return ast["type"]


def operands_of(ast: dict) -> list:
    out: dict = {}

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            items = x.items()
        elif isinstance(x, list):
            items = ((str(i), v) for i, v in enumerate(x))
        else:
            return
        for k, v in items:
            if k in ("fact", "concept") and isinstance(v, str):
                out[v] = None
            elif k == "concepts" and isinstance(v, list):
                for c in v:
                    out[c] = None
            elif isinstance(v, (dict, list)):
                walk(v)

    walk(ast)
    return list(out)
