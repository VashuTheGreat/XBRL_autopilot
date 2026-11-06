"""Date helpers: parsing and formatting dates in Indian and international business conventions."""

from __future__ import annotations
import re
from typing import Any, Dict, Optional
from .periods import iso_date

MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]

_ISO_MATCH = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ISO_RELAXED = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_DMY_DELIM = re.compile(r"^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$")
_DMY_COMPACT = re.compile(r"^(\d{2})(\d{2})(\d{4})$")


def dmy_of(iso: Any) -> str:
    s = str(iso or "")
    m = _ISO_MATCH.match(s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return s


dmyOf = dmy_of


def long_date(iso: Any) -> str:
    s = str(iso or "")
    m = _ISO_MATCH.match(s)
    if m and iso_date(s):
        day = int(m.group(3))
        month = MONTHS[int(m.group(2)) - 1]
        year = m.group(1)
        return f"{day} {month} {year}"
    return ""


longDate = long_date


def iso_of_dmy(text: Any) -> Dict[str, str]:
    s = str(text or "").strip()
    if not s:
        return {"iso": ""}

    m = _ISO_RELAXED.match(s)
    if m:
        y, mo, d = m.group(1), m.group(2), m.group(3)
    else:
        m = _DMY_DELIM.match(s)
        if m:
            d, mo, y = m.group(1), m.group(2), m.group(3)
        else:
            m = _DMY_COMPACT.match(s)
            if m:
                d, mo, y = m.group(1), m.group(2), m.group(3)
            else:
                return {
                    "error": f"'{s}' is not a date. Type it day first as dd-mm-yyyy, e.g. 05-09-2026 for 5 September 2026."
                }

    iso = f"{y}-{int(mo):02d}-{int(d):02d}"
    if not iso_date(iso):
        return {
            "error": f"'{s}' is not a date (day {int(d)}, month {int(mo)}, year {y}). Type it day first as dd-mm-yyyy, e.g. 05-09-2026 for 5 September 2026."
        }
    return {"iso": iso}


isoOfDmy = iso_of_dmy
