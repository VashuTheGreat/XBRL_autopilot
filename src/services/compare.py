"""Filing comparison: computes diff between two filing versions."""

from __future__ import annotations
import json
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core import decimal as Dec
from src.core.periods import scope_of
from src.core.richtext import plain_text

META_FIELDS = [
    ("name", "Company name"),
    ("cin", "CIN"),
    ("reportType", "Standalone / consolidated"),
    ("periods.cy.start", "Current year from"),
    ("periods.cy.end", "Current year to"),
    ("periods.py.start", "Previous year from"),
    ("periods.py.end", "Previous year to"),
    ("level", "Level of rounding"),
    ("displayPlaces", "Decimal places as presented"),
    ("statementPlaces", "Statement figures rounded to"),
    ("textEmphasis", "Bold / italic / underline setting"),
    ("firstFinancialYear", "First financial year"),
]


def get_path(o: Dict[str, Any], path: str) -> Any:
    cur = o
    for k in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def dims_key(dims: List[Dict[str, Any]]) -> str:
    parts = []
    for d in dims:
        val = d.get("member") or f'"{d.get("typed")}"'
        parts.append(f"{d['axis']}={val}")
    return "|".join(sorted(parts))


def text_of(v: Any) -> str:
    s = plain_text(str(v or ""))
    return " ".join(s.split())


def year_of(filing: Any, period: Dict[str, Any]) -> str:
    s = scope_of(filing.meta.get("periods", {}), period)
    if s and s != "OTHER":
        return s
    return period.get("date") if period.get("type") == "instant" else f"{period.get('start')}..{period.get('end')}"


def index_filing(A: Any, filing: Any) -> Dict[str, Any]:
    m = {}
    for f in filing.all():
        k = f"{f.concept}#{year_of(filing, f.period)}#{dims_key(f.dims)}"
        m[k] = f
    return m


def same_fact(A: Any, a: Any, b: Any) -> bool:
    if bool(a.nil) != bool(b.nil):
        return False
    if a.nil:
        return True
    if A.is_numeric(a.concept):
        try:
            if Dec.cmp(Dec.parse(a.value), Dec.parse(b.value)) != 0:
                return False
        except Exception:
            if a.value != b.value:
                return False
        return str(a.decimals or "") == str(b.decimals or "") or a.decimals is None or b.decimals is None
    return str(a.value) == str(b.value)


def compare_filings(A: Any, first: Any, second: Any) -> Dict[str, Any]:
    meta = []
    for field, label in META_FIELDS:
        a_val = get_path(first.meta, field)
        b_val = get_path(second.meta, field)
        if json.dumps(a_val, sort_keys=True) != json.dumps(b_val, sort_keys=True):
            meta.append({"field": field, "label": label, "a": a_val, "b": b_val})

    different_years = first.meta.get("periods", {}).get("cy", {}).get("end") != second.meta.get("periods", {}).get("cy", {}).get("end")
    ia = index_filing(A, first)
    ib = index_filing(A, second)
    facts = []

    for k, a in ia.items():
        b = ib.get(k)
        year = year_of(first, a.period)
        if not b:
            facts.append({"kind": "removed", "concept": a.concept, "year": year, "dims": a.dims, "a": a, "b": None})
            continue
        if same_fact(A, a, b):
            continue
        is_text = not A.is_numeric(a.concept) and A.data_type(a.concept) == "textBlock"
        format_only = is_text and not a.nil and not b.nil and text_of(a.value) == text_of(b.value)
        decimals_only = False
        if A.is_numeric(a.concept) and not a.nil and not b.nil:
            try:
                decimals_only = Dec.cmp(Dec.parse(a.value), Dec.parse(b.value)) == 0
            except Exception:
                pass
        facts.append({
            "kind": "changed",
            "concept": a.concept,
            "year": year,
            "dims": a.dims,
            "a": a,
            "b": b,
            "formatOnly": format_only,
            "decimalsOnly": decimals_only,
        })

    for k, b in ib.items():
        if k not in ia:
            facts.append({"kind": "added", "concept": b.concept, "year": year_of(second, b.period), "dims": b.dims, "a": None, "b": b})

    def extract_notes(filing: Any) -> Dict[str, Any]:
        m = {}
        for fn in filing.footnotes.values():
            cells = []
            for key in fn.fact_keys:
                f = filing.facts.get(key)
                if f:
                    cells.append(f"{f.concept}#{year_of(filing, f.period)}#{dims_key(f.dims)}")
            cells_str = ",".join(sorted(cells))
            m[f"{text_of(fn.text)}@{cells_str}"] = fn
        return m

    na = extract_notes(first)
    nb = extract_notes(second)
    footnotes = [
        {"kind": "removed", "a": fn, "b": None} for k, fn in na.items() if k not in nb
    ] + [
        {"kind": "added", "a": None, "b": fn} for k, fn in nb.items() if k not in na
    ]

    counts = {
        "meta": len(meta),
        "changed": sum(1 for x in facts if x["kind"] == "changed"),
        "added": sum(1 for x in facts if x["kind"] == "added"),
        "removed": sum(1 for x in facts if x["kind"] == "removed"),
        "footnotes": len(footnotes),
    }
    counts["total"] = counts["meta"] + counts["changed"] + counts["added"] + counts["removed"] + counts["footnotes"]

    return {"meta": meta, "facts": facts, "footnotes": footnotes, "differentYears": different_years, "counts": counts}


compareFilings = compare_filings
