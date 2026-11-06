import pytest
import math
from src.core import decimal as Dec


def test_decimal_arithmetic_exact():
    assert Dec.to_string(Dec.add("0.1", "0.2")) == "0.3"
    assert Dec.to_string(Dec.mul("1234.5", "100000")) == "123450000"
    assert Dec.to_string(Dec.round_dec("1234567", -3)) == "1235000"
    assert Dec.to_string(Dec.round_dec("-2.5", 0)) == "-3"
    assert Dec.to_string(Dec.parse("1.20E3")) == "1200"
    assert Dec.required_decimals("1234500") == -2
    assert Dec.to_string(Dec.shift("12.345", 5)) == "1234500"


def test_decimal_sub_and_cmp():
    assert Dec.to_string(Dec.sub("10", "3.5")) == "6.5"
    assert Dec.cmp("1.2", "1.20") == 0
    assert Dec.eq("1.2", "1.20")
    assert Dec.cmp("1.2", "1.3") == -1
    assert Dec.cmp("1.5", "1.3") == 1
    assert Dec.is_zero("0")
    assert Dec.is_zero("0.000")
    assert not Dec.is_zero("0.001")


def test_decimal_div():
    # div by integer
    d = Dec.parse("10")
    assert Dec.to_string(Dec.div_dec(d, 3)) == "3.333333333333"
    assert Dec.to_string(Dec.div_dec("1", 2)) == "0.5"


def test_to_fixed():
    assert Dec.to_fixed("12.3", 3) == "12.300"
    assert Dec.to_fixed("12.3456", 2) == "12.35"
    assert Dec.to_fixed("12.34", 0) == "12"
