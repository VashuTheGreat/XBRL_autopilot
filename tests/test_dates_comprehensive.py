import pytest
from src.core.dates import dmy_of, iso_of_dmy, long_date


def test_day_first_various_separators():
    for s in ["05-09-2026", "5-9-2026", "05/09/2026", "05.09.2026", "5 9 2026", "05092026", " 05-09-2026 "]:
        res = iso_of_dmy(s)
        assert res.get("iso") == "2026-09-05", s

    assert iso_of_dmy("31-03-2026") == {"iso": "2026-03-31"}
    assert iso_of_dmy("29-02-2024") == {"iso": "2024-02-29"}


def test_iso_input_and_empty():
    assert iso_of_dmy("2026-09-05") == {"iso": "2026-09-05"}
    assert iso_of_dmy("") == {"iso": ""}
    assert iso_of_dmy("   ") == {"iso": ""}


def test_invalid_dates_refused():
    for s in ["31-02-2026", "29-02-2025", "05-13-2026", "00-01-2026", "5 Sept 2026", "05-09-26", "2026/09/05x"]:
        r = iso_of_dmy(s)
        assert "error" in r and "dd-mm-yyyy" in r["error"], s


def test_dmy_display_and_long_date():
    assert dmy_of("2026-09-05") == "05-09-2026"
    assert dmy_of("") == ""
    assert long_date("2026-09-05") == "5 September 2026"
    assert long_date("2026-05-09") == "9 May 2026"
    assert long_date("2026-02-30") == ""

    for iso in ["2026-01-01", "2026-12-31", "2024-02-29"]:
        assert iso_of_dmy(dmy_of(iso))["iso"] == iso
