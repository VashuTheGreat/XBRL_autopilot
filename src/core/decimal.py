"""Exact decimal arithmetic on BigInt / arbitrary-precision integers.

Normalized representation: Dec(n, s) represents n * 10^(-s) with scale s >= 0
and no trailing zeros (unless n == 0, where s == 0).
"""

from __future__ import annotations
import math
import re
from dataclasses import dataclass
from typing import Any, Iterable, Union

TEN = 10
_DEC_RE = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")


@dataclass(frozen=True, slots=True)
class Dec:
    n: int
    s: int

    def __repr__(self) -> str:
        return f"Dec({to_string(self)})"

    def __str__(self) -> str:
        return to_string(self)

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, (Dec, int, float, str)):
            return False
        try:
            return eq(self, other)
        except Exception:
            return False

    def __lt__(self, other: Any) -> bool:
        return cmp(self, other) < 0

    def __le__(self, other: Any) -> bool:
        return cmp(self, other) <= 0

    def __gt__(self, other: Any) -> bool:
        return cmp(self, other) > 0

    def __ge__(self, other: Any) -> bool:
        return cmp(self, other) >= 0


ZERO = Dec(0, 0)


def pow10(k: int) -> int:
    if k < 0:
        raise ValueError("pow10 requires a non-negative exponent")
    return TEN**k


def is_decimal_string(val: Any) -> bool:
    if not isinstance(val, str):
        return False
    return bool(_DEC_RE.match(val.strip()))


isDecimalString = is_decimal_string


def norm(n: int, s: int) -> Dec:
    while s > 0 and n % 10 == 0:
        n //= 10
        s -= 1
    if n == 0:
        s = 0
    return Dec(n, s)


def parse(val: Any) -> Dec:
    if isinstance(val, Dec):
        return val
    if isinstance(val, int):
        return norm(val, 0)
    if isinstance(val, float):
        if not math.isfinite(val):
            raise ValueError(f"Not a finite number: {val}")
        val = str(val)

    t = str(val).strip().replace(",", "")
    if not is_decimal_string(t):
        raise ValueError(f'Invalid decimal: "{val}"')

    mant, _, exp = t.lower().partition("e")
    sign = 1
    if mant.startswith("-"):
        sign = -1
        mant = mant[1:]
    elif mant.startswith("+"):
        mant = mant[1:]

    ip, _, fp = mant.partition(".")
    n = int((ip or "0") + fp) * sign
    s = len(fp)
    e = int(exp) if exp else 0

    if e > 0:
        if e >= s:
            n *= pow10(e - s)
            s = 0
        else:
            s -= e
    elif e < 0:
        s += -e

    return norm(n, s)


def D(x: Any) -> Dec:
    return x if isinstance(x, Dec) else parse(x)


def align(a: Dec, b: Dec) -> tuple[int, int, int]:
    s = max(a.s, b.s)
    return (a.n * pow10(s - a.s), b.n * pow10(s - b.s), s)


def add(a: Any, b: Any) -> Dec:
    x, y, s = align(D(a), D(b))
    return norm(x + y, s)


def sub(a: Any, b: Any) -> Dec:
    x, y, s = align(D(a), D(b))
    return norm(x - y, s)


def mul(a: Any, b: Any) -> Dec:
    da, db = D(a), D(b)
    return norm(da.n * db.n, da.s + db.s)


def neg(a: Any) -> Dec:
    da = D(a)
    return Dec(-da.n, da.s)


def cmp(a: Any, b: Any) -> int:
    x, y, _ = align(D(a), D(b))
    return -1 if x < y else (1 if x > y else 0)


def eq(a: Any, b: Any) -> bool:
    return cmp(a, b) == 0


def is_zero(a: Any) -> bool:
    return D(a).n == 0


isZero = is_zero


def sign(a: Any) -> int:
    n = D(a).n
    return -1 if n < 0 else (1 if n > 0 else 0)


def sum_dec(items: Iterable[Any]) -> Dec:
    res = ZERO
    for it in items:
        res = add(res, it)
    return res


# JS export alias
sum = sum_dec


def shift(a: Any, k: int) -> Dec:
    da = D(a)
    if k >= 0:
        if da.s >= k:
            return norm(da.n, da.s - k)
        return norm(da.n * pow10(k - da.s), 0)
    return norm(da.n, da.s - k)


def fraction_digits(a: Any) -> int:
    return D(a).s


fractionDigits = fraction_digits


def required_decimals(a: Any) -> Union[int, float]:
    da = D(a)
    if da.n == 0:
        return float("inf")
    if da.s > 0:
        return da.s
    n = abs(da.n)
    tz = 0
    while n % 10 == 0:
        n //= 10
        tz += 1
    return -tz


requiredDecimals = required_decimals


def round_dec(a: Any, decimals: Any) -> Dec:
    da = D(a)
    if decimals in ("INF", float("inf"), None):
        return da
    dec = int(decimals)
    if da.s <= dec:
        return da
    drop = da.s - dec
    f = pow10(drop)
    is_neg = da.n < 0
    abs_n = -da.n if is_neg else da.n
    q = abs_n // f
    r = abs_n % f
    if r * 2 >= f:
        q += 1
    n = -q if is_neg else q
    if dec >= 0:
        return norm(n, dec)
    return norm(n * pow10(-dec), 0)


round = round_dec


def to_string(a: Any) -> str:
    da = D(a)
    is_neg = da.n < 0
    digits = str(-da.n if is_neg else da.n)
    if da.s > 0:
        digits = digits.zfill(da.s + 1)
        digits = digits[: -da.s] + "." + digits[-da.s :]
    return ("-" if is_neg else "") + digits


toString = to_string


def to_fixed(a: Any, places: int) -> str:
    r = round_dec(D(a), places)
    s = to_string(r)
    if places <= 0:
        return s
    ip, _, fp = s.partition(".")
    return ip + "." + fp.ljust(places, "0")


toFixed = to_fixed


def div_dec(a: Any, k: int) -> Dec:
    da = D(a)
    K = int(k)
    if K <= 0:
        raise ValueError("div by non-positive integer")
    extra = 13
    q = (da.n * pow10(extra)) // K
    return round_dec(norm(q, da.s + extra), da.s + 12)


div = div_dec
