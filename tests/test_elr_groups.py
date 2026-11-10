import pytest

from src.core.elr_groups import classify_elr, elr_code, elr_title


@pytest.mark.parametrize(
    "definition, group",
    [
        ("[100100] Balance sheet", "Statements"),
        ("[210000a] Statement of profit and loss", "Statements"),
        ("[400200] Statement of changes in equity", "Statements"),  # Ind AS: 4xxxxx is not always a note
        ("[200100] Notes - Share capital", "Notes"),
        ("[610100] Notes - List of accounting policies", "Notes"),
        ("[400100] Disclosure of general information about company", "Disclosures"),
        ("[700400] Disclosures - Auditors report", "Disclosures"),
        ("[100200] General information", "Statements"),  # Costing report section
    ],
)
def test_classify_by_title(definition, group):
    assert classify_elr(definition) == group


def test_code_and_title():
    assert elr_code("[210000a] Statement of profit and loss") == "210000a"
    assert elr_title("[100100] Balance sheet") == "Balance sheet"
    assert elr_code("no code") is None
