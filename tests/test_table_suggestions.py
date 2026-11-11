"""Table suggestions (ADR-0013): blocks of note sheets → taxonomy tables. Synthetic sheets on both filing taxonomies
(no client data), then the real-data floors: DGPL → Dixon (Ind AS) and HPL → the hand-checked key from Helmier's PDF
(C&I). LLM off."""
import datetime as dt

import pytest

from src.evaluation.autotag_eval import DGPL, DIXON
from src.evaluation.coverage_eval import run_dgpl_dixon
from src.evaluation.table_key_eval import HPL_KEY, ROOT, run_key
from src.services.tagging.layout import analyse_sheet
from src.services.tagging.tables import find_blocks, suggest_tables, table_catalog_for

CY, PY = dt.date(2026, 3, 31), dt.date(2025, 3, 31)


def sheet(name: str, rows: dict[int, dict[int, object]]) -> dict:
    return {"name": name, "cells": [{"r": r, "c": c, "v": v} for r, cols in rows.items() for c, v in cols.items()]}


# a PPE roll-forward laid out like DGPL's sheet FA / HPL's note 11a: classes in columns, groups and dates in rows
ROLL_FORWARD = {
    0: {1: "NOTE 5 - PROPERTY, PLANT AND EQUIPMENT", 6: "(Rs. in Lakh unless otherwise stated)"},
    2: {2: "Furniture and fixtures", 3: "Computers", 4: "Office equipment", 5: "Total"},
    3: {1: "Gross carrying amount"},
    4: {1: "Balance as at 1 April 2024", 2: 1.0, 3: 2.0, 4: 3.0, 5: 6.0},
    5: {1: "Additions", 2: 0.5, 3: 0.0, 4: 1.0, 5: 1.5},
    6: {1: "Balance as at 31 March 2025", 2: 1.5, 3: 2.0, 4: 4.0, 5: 7.5},
    7: {1: "Additions", 2: 0.0, 3: 1.0, 4: 0.0, 5: 1.0},
    8: {1: "Balance as at 31 March 2026", 2: 1.5, 3: 3.0, 4: 4.0, 5: 8.5},
    10: {1: "Accumulated depreciation"},
    11: {1: "Balance as at 1 April 2024", 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.6},
    12: {1: "Charge for the year", 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.3},
    13: {1: "Balance as at 31 March 2025", 2: 0.2, 3: 0.3, 4: 0.4, 5: 0.9},
    14: {1: "Charge for the year", 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.3},
    15: {1: "Balance as at 31 March 2026", 2: 0.3, 3: 0.4, 4: 0.5, 5: 1.2},
}


def suggest_one(taxonomy: str, rows: dict) -> dict:
    s = sheet("FA", rows)
    out = suggest_tables(table_catalog_for(taxonomy), [s], [analyse_sheet(s, CY, PY)], CY, PY)
    assert len(out) == 1, out
    return out[0].to_json()


@pytest.mark.parametrize(("taxonomy", "table", "prefix", "balance", "classes"), [
    ("ind_as_taxonomy", "400600:DisclosureOfPropertyPlantAndEquipmentTable", "ind-as", "PropertyPlantAndEquipment",
     ["FurnitureAndFixturesMember", "ComputerEquipmentsMember", "OfficeEquipmentMember"]),
    ("ci_taxonomy", "201000:DisclosureOfTangibleAssetsTable", "in-gaap", "TangibleAssets",
     ["FurnitureAndFixturesMember", "ComputerEquipmentsMember", "OfficeEquipmentMember"]),
])
def test_a_roll_forward_maps_to_the_taxonomy_table(taxonomy, table, prefix, balance, classes):
    b = suggest_one(taxonomy, ROLL_FORWARD)
    assert b["tableId"] == table
    rows = {r["r"]: r for r in b["rows"]}
    gross = f"{prefix}:GrossCarryingAmountMember"
    acc = f"{prefix}:AccumulatedDepreciationAndImpairmentMember"
    # openings dated the first day of the year are the previous year's opening balance
    assert rows[4] == {"r": 4, "concept": f"{prefix}:{balance}", "preferredLabel": "periodStartLabel", "scope": "PY",
                       "members": [{"axis": f"{prefix}:CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis", "member": gross}]}
    assert (rows[5]["scope"], rows[7]["scope"]) == ("PY", "CY")  # a movement belongs to the year of the next closing
    assert rows[8]["preferredLabel"] == "periodEndLabel" and rows[8]["scope"] == "CY"
    assert rows[12]["concept"].endswith("DepreciationTangibleAssets") or rows[12]["concept"].endswith("DepreciationPropertyPlantAndEquipment")
    assert rows[12]["members"][0]["member"] == acc
    members = [c["members"][0]["member"].split(":")[1] if c["members"] else "total" for c in b["cols"]]
    assert members == [*classes, "total"]
    # the total column keeps the row's member (the class total of gross / accumulated amounts)
    total = [c for c in b["cells"] if c["ref"] == "F9"][0]
    assert total["dims"] == [{"axis": f"{prefix}:CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis", "member": gross}]


def test_a_plain_cy_py_note_is_left_to_the_statement_tagger():
    s = sheet("Notes", {2: {1: "Particulars", 3: "As at 31 March 2026", 4: "As at 31 March 2025"},
                        3: {1: "Trade receivables", 3: 10.0, 4: 9.0}, 4: {1: "Loans", 3: 5.0, 4: 4.0}})
    assert find_blocks(s, CY, PY) == []


def test_changes_in_equity_by_component():
    rows = {
        1: {0: "STATEMENT OF CHANGES IN EQUITY", 3: "(Rs. in Lakh unless otherwise stated)"},
        3: {2: "Retained earnings", 3: "Total"},
        4: {0: "Balance as at 31st March, 2025", 2: 100.0, 3: 100.0},
        5: {0: "Profit/(loss) for the year", 2: 20.0, 3: 20.0},
        6: {0: "Balance as at 31st March, 2026", 2: 120.0, 3: 120.0},
    }
    b = suggest_one("ind_as_taxonomy", rows)
    assert b["tableId"] == "400200:StatementOfChangesInEquityTable"
    assert b["cols"][0]["members"] == [{"axis": "ind-as:ComponentsOfEquityAxis", "member": "ind-as:RetainedEarningsMember"}]
    assert [(r["concept"].split(":")[1], r["preferredLabel"], r["scope"]) for r in b["rows"]] == [
        ("OtherEquityBalances", "periodEndLabel", "PY"), ("ProfitLossForPeriod", None, "CY"), ("OtherEquityBalances", "periodEndLabel", "CY")]


# ------------------------------------------------------------------ real data
real = pytest.mark.skipif(not (DGPL.exists() and DIXON.exists()), reason="real-data fixtures not present")


@real
def test_dixon_table_producer_floors():
    report, result = run_dgpl_dixon()
    t = report.by_producer["table"]
    produced = t["right"] + t["near"] + t["wrong"]
    print(report.text())
    assert t["right"] >= 60, t  # 63 on 2026-11-11 (PPE, changes in equity)
    assert t["wrong"] <= 0.1 * produced, t  # ADR-0013: table amounts wrong ≤ 10% of those produced
    assert t["extra"] <= 10, t
    also = report.by_producer["also"]  # one-class "also report as", only on sure statement tags: 2 right, 0 wrong
    assert also["right"] >= 2 and also["wrong"] == 0, also
    assert {b.table_id for b in result.blocks} >= {"400600:DisclosureOfPropertyPlantAndEquipmentTable", "400200:StatementOfChangesInEquityTable"}


@pytest.mark.skipif(not (HPL_KEY.exists() and any((ROOT / "data").glob("HPL*.xlsx"))), reason="HPL workbook not present")
def test_hpl_hand_checked_key_ci():
    r = run_key()
    print(r.text())
    assert len(r.right) >= 13 and not r.wrong and not r.missing, r.text()
