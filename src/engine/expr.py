"""Expression / predicate evaluator shared by the business-rule engine and the applicability engine.

Three-valued logic: True / False / None (not determinable).
"""

from __future__ import annotations
import calendar
import datetime
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from src.core import decimal as Dec
from src.core.dimensions import dimensionally_valid
from src.core.model import dim_key

FORMATS = {
    "CIN": re.compile(r"^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$"),
    "PAN": re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$"),
    "DIN": re.compile(r"^\d{8}$"),
}


def typed(A: Any, concept: str, raw: Any) -> Any:
    if raw is None:
        return None
    if A.is_numeric(concept):
        return Dec.parse(raw)
    t = A.data_type(concept)
    if t == "boolean":
        return str(raw).lower() == "true"
    return raw


def fact_value(env: Dict[str, Any], concept: str, dims: Optional[List[Dict[str, Any]]], scope_override: Optional[str] = None) -> Any:
    filing = env["filing"]
    A = env["A"]
    scope = scope_override or env.get("scope")
    v = filing.value(concept, scope, dims or [])
    return typed(A, concept, v)


factValue = fact_value

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_iso_date(v: Any) -> bool:
    return isinstance(v, str) and bool(_ISO_DATE_RE.match(v.strip()))


def add_months(iso: str, n: int) -> str:
    s = str(iso).strip()[:10]
    y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
    t = y * 12 + (m - 1) + n
    ny, nm = t // 12, (t % 12) + 1
    _, max_d = calendar.monthrange(ny, nm)
    return f"{ny:04d}-{nm:02d}-{min(d, max_d):02d}"


addMonths = add_months


def add_days(iso: str, n: int) -> str:
    s = str(iso).strip()[:10]
    y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
    dt = datetime.date(y, m, d) + datetime.timedelta(days=n)
    return dt.isoformat()


addDays = add_days


def same_period(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if a.get("type") != b.get("type"):
        return False
    if a.get("type") == "instant":
        return a.get("date") == b.get("date")
    return a.get("start") == b.get("start") and a.get("end") == b.get("end")


def facts_in_scope(env: Dict[str, Any], concept: str) -> List[Any]:
    filing = env["filing"]
    period = filing.period(concept, env.get("scope"))
    if not period:
        return []
    return [
        f
        for f in filing.facts_of(concept)
        if not f.nil and f.value is not None and same_period(f.period, period)
    ]


_MMA_CACHE: Dict[Tuple[int, str, str], Set[str]] = {}


def mandatory_member_axes(A: Any, concept: str, axis: str) -> Set[str]:
    k = (id(A), concept, axis)
    if k in _MMA_CACHE:
        return _MMA_CACHE[k]
    out: Set[str] = set()
    for t in A.tables:
        if concept not in t.get("lineItems", []):
            continue
        if not any(x.get("axis") == axis for x in t.get("axes", [])):
            continue
        for x in t.get("axes", []):
            if x.get("axis") != axis and not x.get("typed") and x.get("default"):
                unusable = any(m.get("member") == x["default"] and not m.get("usable") for m in x.get("members", []))
                if unusable:
                    out.add(x["axis"])
    _MMA_CACHE[k] = out
    return out


def sum_axis_facts(spec: Dict[str, Any], env: Dict[str, Any]) -> Optional[List[Any]]:
    filing = env["filing"]
    A = env["A"]
    scope = env.get("scope")
    period = filing.period(spec["concept"], scope)
    if not period:
        return None

    facts = [
        f
        for f in filing.facts_of(spec["concept"])
        if not f.nil and f.value is not None and same_period(f.period, period)
    ]
    fixed = spec.get("fixed", {})
    always = mandatory_member_axes(A, spec["concept"], spec["axis"])

    candidates = []
    for f in facts:
        on = next((d for d in f.dims if d["axis"] == spec["axis"]), None)
        if not on:
            continue
        match_fixed = True
        for ax, mem in fixed.items():
            if not any(d["axis"] == ax and d.get("member") == mem for d in f.dims):
                match_fixed = False
                break
        if not match_fixed:
            continue
        if not spec.get("anyOther"):
            has_unwanted = False
            for d in f.dims:
                if d["axis"] != spec["axis"] and d["axis"] not in fixed and d["axis"] not in always:
                    has_unwanted = True
                    break
            if has_unwanted:
                continue
        candidates.append(f)

    def member_of(f: Any) -> str:
        d = next((x for x in f.dims if x["axis"] == spec["axis"]), None)
        if not d:
            return ""
        return d.get("member") or f'"{d.get("typed")}"'

    level = spec.get("level")
    if level == "all":
        return candidates
    if level == "members":
        wanted = spec.get("members", [])
        return [f for f in candidates if member_of(f) in wanted]
    if level == "pattern":
        pat = re.compile(spec.get("pattern", ""))
        return [f for f in candidates if pat.search(member_of(f).split(":")[-1])]
    if level == "firstLevel":
        info = A.axis_info(spec["axis"])
        children: Dict[str, List[str]] = {}
        parents = info.get("parents", {}) if info else {}
        for m, p in parents.items():
            children.setdefault(p, []).append(m)
        members_map = info.get("members", {}) if info else {}
        roots = [m for m in members_map.keys() if m not in parents]
        by_member: Dict[str, List[Any]] = {}
        for f in candidates:
            by_member.setdefault(member_of(f), []).append(f)

        picked: List[Any] = []

        def take(m: str):
            if m in by_member:
                picked.extend(by_member[m])
                return
            for c in children.get(m, []):
                take(c)

        for r in roots:
            for c in children.get(r, []):
                take(c)
        return picked

    raise ValueError(f"Unknown sumAxis level {level}")


sumAxisFacts = sum_axis_facts


def sum_axis(spec: Dict[str, Any], env: Dict[str, Any]) -> Optional[Dec.Dec]:
    picked = sum_axis_facts(spec, env)
    if not picked:
        return None
    res = Dec.ZERO
    for f in picked:
        res = Dec.add(res, Dec.parse(f.value))
    return res


sumAxis = sum_axis


def table_facts(env: Dict[str, Any], table_id: str) -> List[Any]:
    filing = env["filing"]
    A = env["A"]
    scope = env.get("scope")
    t = A.table(table_id)
    if not t:
        return []
    items = set(t.get("lineItems", []))
    axes = {x["axis"] for x in t.get("axes", [])}
    return [
        f
        for f in filing.all()
        if f.concept in items
        and not f.nil
        and len(f.dims) > 0
        and all(d["axis"] in axes for d in f.dims)
        and filing.scope_of(f.period) == scope
    ]


def eval_expr(e: Optional[Dict[str, Any]], env: Dict[str, Any]) -> Any:
    if e is None:
        return None
    if "self" in e and e["self"]:
        s = env.get("self")
        if s is None:
            return None
        val = None if getattr(s, "nil", False) else getattr(s, "value", None)
        return typed(env["A"], getattr(s, "concept"), val)
    if "fact" in e:
        dims = [] if e.get("ctx") == "nondim" else env.get("dims", [])
        return fact_value(env, e["fact"], dims, e.get("scope"))
    if "addMonths" in e:
        v = eval_expr(e["addMonths"]["e"], env)
        return add_months(v.strip(), e["addMonths"]["n"]) if is_iso_date(v) else None
    if "addDays" in e:
        v = eval_expr(e["addDays"]["e"], env)
        return add_days(v.strip(), e["addDays"]["n"]) if is_iso_date(v) else None
    if "avgAxis" in e:
        picked = sum_axis_facts(e["avgAxis"], env)
        if not picked:
            return None
        total = Dec.sum_dec(Dec.parse(f.value) for f in picked)
        return Dec.div_dec(total, len(picked))
    if "maxFacts" in e:
        vals = []
        for q in e["maxFacts"]:
            for f in facts_in_scope(env, q):
                s = str(f.value or "").strip()
                if is_iso_date(s):
                    vals.append(s)
        return sorted(vals)[-1] if vals else None
    if "const" in e:
        c = e["const"]
        return Dec.parse(c) if isinstance(c, (int, float)) else c
    if "today" in e and e["today"]:
        return env.get("today")
    if "upper" in e:
        v = eval_expr(e["upper"], env)
        return str(v).upper().strip() if v is not None else None
    if "mul" in e:
        vs = [eval_expr(x, env) for x in e["mul"]]
        if any(v is None for v in vs):
            return None
        res = Dec.parse(vs[0])
        for x in vs[1:]:
            res = Dec.mul(res, Dec.parse(x))
        return res
    if "add" in e:
        vs = [eval_expr(x, env) for x in e["add"]]
        if any(v is None for v in vs):
            return None
        return Dec.sum_dec(Dec.parse(x) for x in vs)
    if "sumAxis" in e:
        return sum_axis(e["sumAxis"], env)

    raise ValueError(f"Unknown expression {e}")


evalExpr = eval_expr


def compare_vals(cmp_op: str, l: Any, r: Any) -> Optional[bool]:
    if isinstance(l, Dec.Dec) and isinstance(r, Dec.Dec):
        c = Dec.cmp(l, r)
    elif isinstance(l, bool) or isinstance(r, bool):
        if cmp_op == "==":
            return l == r
        if cmp_op == "!=":
            return l != r
        return None
    else:
        a, b = str(l), str(r)
        c = -1 if a < b else (1 if a > b else 0)

    if cmp_op == "==":
        return c == 0
    if cmp_op == "!=":
        return c != 0
    if cmp_op == ">":
        return c > 0
    if cmp_op == ">=":
        return c >= 0
    if cmp_op == "<":
        return c < 0
    if cmp_op == "<=":
        return c <= 0
    raise ValueError(f"Unknown comparator {cmp_op}")


def eval_pred(p: Optional[Dict[str, Any]], env: Dict[str, Any]) -> Optional[bool]:
    if not p:
        return True
    op = p.get("op")

    if op == "entered":
        e = p.get("e", {})
        if "fact" in e:
            dims = [] if e.get("ctx") == "nondim" else env.get("dims", [])
            if dims and not dimensionally_valid(env["A"], e["fact"], dims).get("valid"):
                dims = []
            return env["filing"].value(e["fact"], env.get("scope"), dims) is not None
        return eval_expr(e, env) is not None

    if op == "cmp":
        l = eval_expr(p.get("l"), env)
        r = eval_expr(p.get("r"), env)
        if p.get("cmp") == "==":
            def is_amount(v: Any) -> bool:
                return isinstance(v, Dec.Dec)

            if r is None and p.get("r", {}).get("sumAxis") and p.get("l", {}).get("self") and is_amount(l):
                r = Dec.ZERO
            elif l is None and p.get("l", {}).get("sumAxis") and p.get("r", {}).get("self") and is_amount(r):
                l = Dec.ZERO

        if l is None or r is None:
            return None

        if p.get("approx") and isinstance(l, Dec.Dec) and isinstance(r, Dec.Dec):
            self_fact = env.get("self")
            if self_fact and self_fact.decimals is not None and self_fact.decimals != "INF":
                dec = int(self_fact.decimals)
            else:
                dec = Dec.fraction_digits(l)
            r = Dec.round_dec(r, dec)

        return compare_vals(p.get("cmp", "=="), l, r)

    if op == "notInFacts":
        v = eval_expr(p.get("e"), env)
        if v is None:
            return None
        self_fact = env.get("self")
        others = [f for f in facts_in_scope(env, p["concept"]) if not self_fact or f.key != self_fact.key]
        v_upper = str(v).strip().upper()
        return not any(str(f.value).strip().upper() == v_upper for f in others)

    if op == "existsFact":
        return any(
            eval_pred(p.get("pred"), {**env, "self": f, "dims": f.dims}) is True
            for f in facts_in_scope(env, p["concept"])
        )

    if op == "iff":
        args = p.get("args", [])
        a = eval_pred(args[0], env)
        b = eval_pred(args[1], env)
        return None if (a is None or b is None) else (a == b)

    if op == "tableData":
        return any(len(table_facts(env, tid)) > 0 for tid in p.get("tables", []))

    if op == "memberHasData":
        return any(
            any(any(d.get("member") == p["member"] for d in f.dims) for f in table_facts(env, tid))
            for tid in p.get("tables", [])
        )

    if op == "and":
        unk = False
        for a in p.get("args", []):
            v = eval_pred(a, env)
            if v is False:
                return False
            if v is None:
                unk = True
        return None if unk else True

    if op == "or":
        unk = False
        for a in p.get("args", []):
            v = eval_pred(a, env)
            if v is True:
                return True
            if v is None:
                unk = True
        return None if unk else False

    if op == "not":
        v = eval_pred(p.get("arg"), env)
        return None if v is None else (not v)

    if op == "reportType":
        return env["filing"].meta.get("reportType") == p.get("value")

    if op == "format":
        v = eval_expr(p.get("e"), env)
        if v is None:
            return None
        s_val = str(v).strip()
        fmt = p.get("format")
        if fmt == "country":
            return s_val.upper() in env.get("countries", set())
        pattern = FORMATS.get(fmt)
        return bool(pattern and pattern.match(s_val))

    if op == "anyFact":
        period = env["filing"].period(p["concept"], env.get("scope"))
        if not period:
            return None
        facts = [
            f
            for f in env["filing"].facts_of(p["concept"])
            if not f.nil and same_period(f.period, period)
        ]
        if not facts:
            return None
        return any(eval_pred(p.get("pred"), {**env, "self": f, "dims": f.dims}) is True for f in facts)

    if op == "hasMember":
        dims = env.get("dims", [])
        return any(
            d.get("member") == p.get("member") and (not p.get("axis") or d.get("axis") == p.get("axis"))
            for d in dims
        )

    raise ValueError(f"Unknown predicate {op}")


evalPred = eval_pred


def ctx_key(dims: Optional[List[Dict[str, Any]]]) -> str:
    return dim_key(dims)


ctxKey = ctx_key
