"""Units for numeric concepts, as required by the C&I taxonomy item types.

Filing Manual §1.3.1 #8/#24, GR-9 (INR except subsidiary details).
"""

from __future__ import annotations
import re
from typing import Any, Dict, Optional

UNIT_DEFS: Dict[str, Dict[str, Any]] = {
    "INR": {"id": "INR", "measures": ["iso4217:INR"]},
    "shares": {"id": "shares", "measures": ["xbrli:shares"]},
    "pure": {"id": "pure", "measures": ["xbrli:pure"]},
    "INRPerShare": {
        "id": "INRPerShare",
        "numerator": ["iso4217:INR"],
        "denominator": ["xbrli:shares"],
    },
}

_ISO_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_PER_SHARE_RE = re.compile(r"^([A-Z]{3})PerShare$")


def currency_unit(code: str) -> Dict[str, Any]:
    if code == "INR":
        return UNIT_DEFS["INR"]
    if not _ISO_CURRENCY_RE.match(code):
        raise ValueError(f"Invalid ISO 4217 code: {code}")
    return {"id": code, "measures": [f"iso4217:{code}"]}


currencyUnit = currency_unit


def default_unit_for(data_type: str, currency: str = "INR") -> Optional[str]:
    if data_type == "monetary":
        return "INR" if currency == "INR" else currency
    if data_type == "shares":
        return "shares"
    if data_type == "perShare":
        return "INRPerShare"
    if data_type in ("percent", "pure", "decimal"):
        return "pure"
    return None


defaultUnitFor = default_unit_for


def unit_def(unit_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not unit_id:
        return None
    if unit_id in UNIT_DEFS:
        return UNIT_DEFS[unit_id]
    if _ISO_CURRENCY_RE.match(unit_id):
        return currency_unit(unit_id)
    m = _PER_SHARE_RE.match(unit_id)
    if m:
        curr = m.group(1)
        return {
            "id": unit_id,
            "numerator": [f"iso4217:{curr}"],
            "denominator": ["xbrli:shares"],
        }
    return None


unitDef = unit_def


def unit_matches_type(data_type: str, defn: Optional[Dict[str, Any]]) -> bool:
    if not defn:
        return False
    m = defn.get("measures", [])
    if data_type == "monetary":
        return len(m) == 1 and m[0].startswith("iso4217:") and "denominator" not in defn
    if data_type == "shares":
        return len(m) == 1 and m[0] == "xbrli:shares"
    if data_type == "perShare":
        num = defn.get("numerator", [])
        den = defn.get("denominator", [])
        return bool(num and num[0].startswith("iso4217:") and den and den[0] == "xbrli:shares")
    if data_type in ("percent", "pure"):
        return len(m) == 1 and m[0] == "xbrli:pure"
    if data_type == "decimal":
        return True
    return False


unitMatchesType = unit_matches_type


def unit_key(defn: Dict[str, Any]) -> str:
    if "denominator" in defn:
        num = "*".join(defn.get("numerator", []))
        den = "*".join(defn.get("denominator", []))
        return f"{num}/{den}"
    return "*".join(defn.get("measures", []))


unitKey = unit_key
