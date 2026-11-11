"""numbers_in_text: the figures of a text cell (a share count in a note's text, ADR-0013). The same fixture checks the
engine's numbersInText (engine/test/basics.test.ts), so the sidecar's pick and the app's read agree."""
import json
from pathlib import Path

import pytest

from src.services.tagging.text import numbers_in_text

CASES = json.loads((Path(__file__).parent / "fixtures" / "numbers_in_text.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize(("text", "want"), CASES)
def test_numbers_in_text(text, want):
    assert numbers_in_text(text) == want
