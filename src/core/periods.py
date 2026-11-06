"""Period engine: CURRENT / PRIOR separation based on actual reporting dates.

Scopes:
  CY  = current year (duration CY, instant at CY end)
  PY  = previous year (duration PY, instant at PY end — also the CY opening balance)
  PYO = instant at the day before PY start (PY opening balance)
  OTHER = any other period
"""

from __future__ import annotations
import datetime
import re
from typing import Any, Dict, List, Optional, Union

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def iso_date(s: Any) -> bool:
    if not isinstance(s, str) or not _ISO_DATE_RE.match(s):
        return False
    try:
        y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        dt = datetime.date(y, m, d)
        return dt.isoformat() == s
    except (ValueError, OverflowError):
        return False


isoDate = iso_date


def add_days(s: str, n: int) -> str:
    y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
    dt = datetime.date(y, m, d) + datetime.timedelta(days=n)
    return dt.isoformat()


addDays = add_days


def validate_periods(p: Dict[str, Any]) -> List[str]:
    errs = []
    if not isinstance(p, dict):
        return ["Periods configuration missing"]
    for k in ("cy", "py"):
        sub = p.get(k)
        if not sub or not isinstance(sub, dict):
            errs.append(f"{k.upper()} period missing")
            continue
        start, end = sub.get("start", ""), sub.get("end", "")
        if not iso_date(start) or not iso_date(end):
            errs.append(f"{k.upper()} dates must be yyyy-mm-dd")
        elif start > end:
            errs.append(f"{k.upper()} start after end")

    if not errs:
        cy_start = p["cy"]["start"]
        py_end = p["py"]["end"]
        if py_end >= cy_start:
            errs.append("Previous-year period must end before the current-year period starts")

    return errs


validatePeriods = validate_periods


def period_for(periods: Dict[str, Any], period_type: str, scope: str) -> Optional[Dict[str, str]]:
    cy = periods.get("cy", {})
    py = periods.get("py", {})
    if period_type == "duration":
        if scope == "CY":
            return {"type": "duration", "start": cy.get("start", ""), "end": cy.get("end", "")}
        if scope == "PY":
            return {"type": "duration", "start": py.get("start", ""), "end": py.get("end", "")}
        return None

    if scope == "CY":
        return {"type": "instant", "date": cy.get("end", "")}
    if scope == "PY":
        return {"type": "instant", "date": py.get("end", "")}
    if scope == "PYO":
        py_start = py.get("start", "")
        if py_start and iso_date(py_start):
            return {"type": "instant", "date": add_days(py_start, -1)}
    return None


periodFor = period_for


def opening_period_for(periods: Dict[str, Any], scope: str) -> Optional[Dict[str, str]]:
    return period_for(periods, "instant", "PY" if scope == "CY" else "PYO")


openingPeriodFor = opening_period_for


def scope_of(periods: Dict[str, Any], period: Optional[Dict[str, Any]]) -> Optional[str]:
    if not period or not isinstance(period, dict):
        return None
    cy = periods.get("cy", {})
    py = periods.get("py", {})
    p_type = period.get("type")

    if p_type == "duration":
        p_start, p_end = period.get("start"), period.get("end")
        if p_start == cy.get("start") and p_end == cy.get("end"):
            return "CY"
        if p_start == py.get("start") and p_end == py.get("end"):
            return "PY"
        return "OTHER"

    if p_type == "instant":
        p_date = period.get("date")
        if p_date == cy.get("end"):
            return "CY"
        if p_date == py.get("end"):
            return "PY"
        py_start = py.get("start")
        if py_start and iso_date(py_start) and p_date == add_days(py_start, -1):
            return "PYO"
        return "OTHER"

    return "OTHER"


scopeOf = scope_of


def reporting_year(periods: Dict[str, Any], period: Optional[Dict[str, Any]]) -> Optional[str]:
    s = scope_of(periods, period)
    return "PY" if s == "PYO" else s


reportingYear = reporting_year


def period_key(p: Dict[str, Any]) -> str:
    if p.get("type") == "instant":
        return f"I:{p.get('date', '')}"
    return f"D:{p.get('start', '')}:{p.get('end', '')}"


periodKey = period_key


def periods_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if a.get("type") != b.get("type"):
        return False
    if a.get("type") == "instant":
        return a.get("date") == b.get("date")
    a_start, a_end = a.get("start", ""), a.get("end", "")
    b_start, b_end = b.get("start", ""), b.get("end", "")
    return a_start <= b_end and b_start <= a_end and not (a_start == b_start and a_end == b_end)


periodsOverlap = periods_overlap
