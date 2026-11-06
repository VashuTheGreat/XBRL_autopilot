"""Scaling/unit engine — display value vs canonical value.

The XML always carries the canonical (unscaled) value; scale only affects display/entry
and the derived `decimals` (Filing Manual §1.3.1 #19–21: no scale factor in fact content).
"""

from __future__ import annotations
from typing import Any
from . import decimal as Dec

SCALE_POWERS: dict[str, int] = {
    "Actual": 0,
    "Thousands": 3,
    "Lakhs": 5,
    "Millions": 6,
    "Crores": 7,
    "Billions": 9,
}


def scale_power(level: str) -> int:
    if level not in SCALE_POWERS:
        raise ValueError(f"Unknown level of rounding: {level}")
    return SCALE_POWERS[level]


scalePower = scale_power


def to_canonical(display: Any, level: str) -> str:
    return Dec.to_string(Dec.shift(Dec.parse(display), scale_power(level)))


toCanonical = to_canonical


def to_display(canonical: Any, level: str) -> str:
    return Dec.to_string(Dec.shift(Dec.parse(canonical), -scale_power(level)))


toDisplay = to_display


def monetary_decimals(level: str, display_places: Any) -> int:
    return min(2, int(display_places) - scale_power(level))


monetaryDecimals = monetary_decimals


def entered_decimals(canonical: Any) -> int:
    return Dec.fraction_digits(Dec.parse(canonical))


enteredDecimals = entered_decimals


def is_scaled_type(data_type: str) -> bool:
    return data_type == "monetary"


isScaledType = is_scaled_type
