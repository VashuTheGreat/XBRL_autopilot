import pytest
from src.core import periods as Per
from src.core import scaling as Sc
from src.core import units as Un
from src.core import dates as Dt
from src.core import richtext as Rt


def test_periods_basic():
    assert Per.iso_date("2026-03-31")
    assert not Per.iso_date("2026-02-31")
    assert not Per.iso_date("31-03-2026")
    assert Per.add_days("2026-03-31", 1) == "2026-04-01"
    assert Per.add_days("2026-04-01", -1) == "2026-03-31"

    p = {
        "cy": {"start": "2025-04-01", "end": "2026-03-31"},
        "py": {"start": "2024-04-01", "end": "2025-03-31"},
    }
    assert Per.validate_periods(p) == []
    assert Per.scope_of(p, {"type": "duration", "start": "2025-04-01", "end": "2026-03-31"}) == "CY"
    assert Per.scope_of(p, {"type": "duration", "start": "2024-04-01", "end": "2025-03-31"}) == "PY"
    assert Per.scope_of(p, {"type": "instant", "date": "2026-03-31"}) == "CY"
    assert Per.scope_of(p, {"type": "instant", "date": "2025-03-31"}) == "PY"
    assert Per.scope_of(p, {"type": "instant", "date": "2024-03-31"}) == "PYO"
    assert Per.reporting_year(p, {"type": "instant", "date": "2024-03-31"}) == "PY"


def test_scaling_basic():
    assert Sc.to_canonical("12.34", "Lakhs") == "1234000"
    assert Sc.to_canonical("1.5", "Crores") == "15000000"
    assert Sc.to_display("1234000", "Lakhs") == "12.34"
    assert Sc.monetary_decimals("Lakhs", 2) == -3
    assert Sc.monetary_decimals("Actual", 2) == 2
    assert Sc.monetary_decimals("Crores", 2) == -5
    assert Sc.entered_decimals("12.3450") == 3


def test_units_basic():
    assert Un.default_unit_for("monetary", "INR") == "INR"
    assert Un.default_unit_for("shares") == "shares"
    assert Un.default_unit_for("perShare") == "INRPerShare"
    assert Un.default_unit_for("pure") == "pure"

    inr_def = Un.unit_def("INR")
    assert inr_def is not None
    assert Un.unit_matches_type("monetary", inr_def)
    assert not Un.unit_matches_type("shares", inr_def)


def test_dates_basic():
    assert Dt.dmy_of("2026-03-31") == "31-03-2026"
    assert Dt.long_date("2026-09-05") == "5 September 2026"
    res = Dt.iso_of_dmy("05-09-2026")
    assert res == {"iso": "2026-09-05"}
    assert "error" in Dt.iso_of_dmy("invalid-date")


def test_richtext_xml_safe():
    assert Rt.xml_safe("Hello\u000bWorld") == "Hello\nWorld"
    assert Rt.xml_safe("Valid\u0000Invalid") == "ValidInvalid"


def test_richtext_plain_text():
    html = "<p>Hello <b>World</b></p><p>Second paragraph</p>"
    assert Rt.plain_text(html) == "Hello World\nSecond paragraph"


def test_richtext_to_mca_and_from_mca():
    html = "<p>Simple <b>bold</b> text</p>"
    mca = Rt.to_mca(html)
    assert 'class="highlightedText1"' in mca
    assert "<b>" not in mca
    back = Rt.from_mca(mca)
    assert "<b>bold</b>" in back
