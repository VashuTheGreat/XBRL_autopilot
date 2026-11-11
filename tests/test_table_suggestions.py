"""Table suggestions (ADR-0013): blocks of note sheets → taxonomy tables. Synthetic sheets on both filing taxonomies
(no client data), then the real-data floors: DGPL → Dixon (Ind AS) and HPL → the hand-checked key from Helmier's PDF
(C&I). LLM off."""
import datetime as dt

import pytest

from src.evaluation.autotag_eval import DGPL, DIXON
from src.evaluation.coverage_eval import run_dgpl_dixon
from src.evaluation.table_key_eval import HPL_KEY, ROOT, run_key
from src.services.tagging.layout import analyse_sheet
from src.services.tagging.table_suggest import suggest_tables
from src.services.tagging.table_catalog import table_catalog_for
from src.services.tagging.tables import find_blocks

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


# a financial-instruments note laid out like DGPL's: categories in the columns under a stale year header, the classes
# of financial assets in the rows, then the liabilities after the assets' total; the balance sheet gives the figures
BALANCE_SHEET = {
    1: {1: "BALANCE SHEET"},
    2: {1: "Particulars", 3: "As at 31 March 2026", 4: "As at 31 March 2025"},
    4: {1: "Trade receivables", 3: 672.3, 4: 94.7},
    5: {1: "Cash and cash equivalents", 3: 119.87, 4: 326.55},
    6: {1: "Loans", 3: 1020.0, 4: 900.0},
}
INSTRUMENTS = {
    0: {0: "Financial instrument by category"},
    1: {0: "Particulars", 3: "As at March 31, 2025", 6: "As at March 31, 2024"},  # stale: one year early
    2: {3: "FVTPL", 4: "FVTOCI", 5: "Amortised cost", 6: "FVTPL", 7: "FVTOCI", 8: "Amortised cost"},
    3: {0: "Financial assets"},
    4: {0: "Trade receivables", 3: 0.0, 4: 0.0, 5: 672.3, 6: 0.0, 7: 0.0, 8: 94.7},
    5: {0: "Loans", 3: 0.0, 4: 0.0, 5: 1020.0, 6: 0.0, 7: 0.0, 8: 900.0},
    6: {0: "Cash and cash equivalents", 3: 0.0, 4: 0.0, 5: 119.87, 6: 0.0, 7: 0.0, 8: 326.55},
    7: {0: "Security deposits", 3: 0.0, 4: 0.0, 5: 0.0, 6: 0.0, 7: 0.0, 8: 0.0},
    8: {0: "Total of financial assets", 3: 0.0, 4: 0.0, 5: 1812.17, 6: 0.0, 7: 0.0, 8: 1321.25},
    9: {0: "Financial liabilities"},
    10: {0: "Trade payables", 3: 0.0, 4: 0.0, 5: 88.79, 6: 0.0, 7: 0.0, 8: 127.59},
    11: {0: "Total of financial liabilities", 3: 0.0, 4: 0.0, 5: 88.79, 6: 0.0, 7: 0.0, 8: 127.59},
}


def test_financial_assets_by_category_rows_are_members_years_from_the_statements():
    bs, notes = sheet("Balance Sheet", BALANCE_SHEET), sheet("Notes to accounts", INSTRUMENTS)
    layouts = [analyse_sheet(bs, CY, PY), analyse_sheet(notes, CY, PY)]
    blocks = [b.to_json() for b in suggest_tables(table_catalog_for("ind_as_taxonomy"), [bs, notes], layouts, CY, PY)]
    assets = next(b for b in blocks if b["tableId"] == "611100a:DisclosureOfFinancialAssetsTable")
    # the assets' total ends that table: the liabilities are not part of it
    assert max(r["r"] for r in assets["rows"]) < 9
    # only the amortised-cost columns have figures: they are the columns, and their years come from the balance sheet
    # (the header says 2025 / 2024)
    amortised = {"axis": "ind-as:CategoriesOfFinancialAssetsAxis", "member": "ind-as:FinancialAssetsAtAmortisedCostCategoryMember"}
    # the one category with figures among FVTPL / FVTOCI / amortised cost is also the total over the categories
    total = {"alsoTotal": ["ind-as:CategoriesOfFinancialAssetsAxis"]}
    assert assets["cols"] == [{"c": 5, "members": [amortised], "scope": "CY", **total}, {"c": 8, "members": [amortised], "scope": "PY", **total}]
    loans = next(c for c in assets["cells"] if c["ref"] == "F6")
    assert [(a["concept"], [d["axis"] for d in a["dims"]]) for a in loans["also"]] == [("ind-as:FinancialAssets", ["ind-as:ClassesOfFinancialAssetsAxis"])]
    # rows: a named class takes its member, the others the numbered placeholders in row order; zeros and totals none
    members = {r["r"]: r["members"][0]["member"].split(":")[1] for r in assets["rows"]}
    assert members == {4: "TradeReceivablesMember", 5: "OtherFinancialAssetsAtAmortisedCostClass1Member", 6: "OtherFinancialAssetsAtAmortisedCostClass2Member"}
    assert {r["concept"] for r in assets["rows"]} == {"ind-as:FinancialAssets"}


def test_fair_values_by_category_also_report_the_fair_value_line_item():
    # the same note headed "Fair value …": one figure per class is both the carrying amount and the fair value
    fair = {**INSTRUMENTS, 2: {3: "Fair value through profit & loss", 4: "Fair value through other comprehensive income", 5: "Fair value at amortised cost",
                               6: "Fair value through profit & loss", 7: "Fair value through other comprehensive income", 8: "Fair value at amortised cost"}}
    bs, notes = sheet("Balance Sheet", BALANCE_SHEET), sheet("Notes to accounts", fair)
    layouts = [analyse_sheet(bs, CY, PY), analyse_sheet(notes, CY, PY)]
    assets = next(b.to_json() for b in suggest_tables(table_catalog_for("ind_as_taxonomy"), [bs, notes], layouts, CY, PY)
                  if b.table_id == "611100a:DisclosureOfFinancialAssetsTable")
    assert all(r["also"] == [{"concept": "ind-as:FinancialAssetsAtFairValue", "preferredLabel": None}] for r in assets["rows"])
    loans = next(c for c in assets["cells"] if c["ref"] == "F6")
    # four facts from one cell: carrying amount and fair value, with the category and as the total over categories
    facts = {(loans["concept"], len(loans["dims"])), *((a["concept"], len(a["dims"])) for a in loans["also"])}
    assert facts == {("ind-as:FinancialAssets", 2), ("ind-as:FinancialAssets", 1), ("ind-as:FinancialAssetsAtFairValue", 2), ("ind-as:FinancialAssetsAtFairValue", 1)}


# a related-party note laid out like DGPL's sheet RPT: category headers merged over their year columns, a transaction
# row followed by its parties (which sum to it), then the outstanding balances
RELATED_PARTIES = {
    0: {1: "Notes to the financial statements for the year ended 31 March 2026"},
    1: {1: "Note 21 Related party disclosures"},
    2: {6: "Holding Company", 8: "Key Management Personnel"},
    3: {6: "2025-26", 7: "2024-25", 8: "2025-26", 9: "2024-25"},
    5: {1: "(i) Transactions during the year"},
    6: {1: "Purchase including taxes", 6: 3194.12, 7: 2995.78, 8: 0.0, 9: 0.0},
    7: {1: "Alpha Industries Limited", 6: 3194.12, 7: 2995.78, 8: 0.0, 9: 0.0},
    9: {1: "Sales of goods inclusive of taxes", 6: 4276.39, 7: 0.43, 8: 0.0, 9: 0.0},
    10: {1: "Alpha Industries Limited", 6: 4276.39, 7: 0.43, 8: 0.0, 9: 0.0},
    11: {1: "Beta Components Private Limited", 6: 0.0, 7: 0.0, 8: 0.0, 9: 0.0},
    13: {1: "Interest received", 6: 85.29, 7: 86.01, 8: 0.0, 9: 0.0},
    14: {1: "Alpha Industries Limited", 6: 85.29, 7: 86.01, 8: 0.0, 9: 0.0},
    16: {1: "Purchase of goods", 6: 0.0, 7: 0.0, 8: 2.0, 9: 0.5},
    17: {1: "Mr. Ravi Kumar", 6: 0.0, 7: 0.0, 8: 2.0, 9: 0.5},
    19: {1: "(ii) Outstanding balances at the year end"},
    20: {1: "Trade Receivables", 6: 504.49, 7: 0.0, 8: 0.0, 9: 0.0},
    21: {1: "Alpha Industries Limited", 6: 504.49, 7: 0.0, 8: 0.0, 9: 0.0},
    23: {1: "Trade Payables", 6: 0.0, 7: 90.69, 8: 0.0, 9: 0.0},
    24: {1: "Alpha Industries Limited", 6: 0.0, 7: 90.69, 8: 0.0, 9: 0.0},
}


def test_related_party_transactions_by_party_and_category():
    s = {**sheet("RPT", RELATED_PARTIES), "merges": [{"r1": 2, "c1": 6, "r2": 2, "c2": 7}, {"r1": 2, "c1": 8, "r2": 2, "c2": 9}]}
    out = suggest_tables(table_catalog_for("ind_as_taxonomy"), [s], [analyse_sheet(s, CY, PY)], CY, PY)
    assert len(out) == 1, out
    b = out[0].to_json()
    assert b["tableId"].endswith("DisclosureOfTransactionsBetweenRelatedPartiesTable")
    parent = {"axis": "ind-as:CategoriesOfRelatedPartiesAxis", "member": "ind-as:ParentMember"}
    kmp = {"axis": "ind-as:CategoriesOfRelatedPartiesAxis", "member": "ind-as:KeyManagementPersonnelOfEntityOrParentMember"}
    assert [(c["c"], c["members"], c["scope"]) for c in b["cols"]] == [(6, [parent], "CY"), (7, [parent], "PY"), (8, [kmp], "CY"), (9, [kmp], "PY")]
    facts = {(c["ref"], c["concept"].split(":")[1], c["scope"], c["dims"][0].get("typed"), c["dims"][1]["member"].split(":")[1]) for c in b["cells"]}
    # each party is numbered in order of first appearance and reports only its non-zero figures under its category;
    # "Interest received" names no line item; a party with only zeros (Beta) gets no number
    assert facts == {
        ("G8", "PurchasesOfGoodsRelatedPartyTransactions", "CY", "1", "ParentMember"),
        ("H8", "PurchasesOfGoodsRelatedPartyTransactions", "PY", "1", "ParentMember"),
        ("G11", "RevenueFromSaleOfGoodsRelatedPartyTransactions", "CY", "1", "ParentMember"),
        ("H11", "RevenueFromSaleOfGoodsRelatedPartyTransactions", "PY", "1", "ParentMember"),
        ("I18", "PurchasesOfGoodsRelatedPartyTransactions", "CY", "2", "KeyManagementPersonnelOfEntityOrParentMember"),
        ("J18", "PurchasesOfGoodsRelatedPartyTransactions", "PY", "2", "KeyManagementPersonnelOfEntityOrParentMember"),
        ("G22", "AmountsReceivableRelatedPartyTransactions", "CY", "1", "ParentMember"),
        ("H25", "AmountsPayableRelatedPartyTransactions", "PY", "1", "ParentMember"),
    }
    # a party's row is limited to its own non-zero columns, so the app files nothing else from it
    assert next(r for r in b["rows"] if r["r"] == 21)["cols"] == [6]


def test_a_statement_figure_is_also_filed_in_the_table_that_sub_classifies_it():
    from src.services.tagging.catalog import catalog_for
    from src.services.tagging.suggest import suggest

    bs = sheet("Balance Sheet", {
        1: {1: "BALANCE SHEET"}, 2: {1: "Particulars", 3: "As at 31 March 2026", 4: "As at 31 March 2025"},
        3: {1: "Current assets"}, 4: {1: "Trade receivables", 3: 672.3, 4: 94.7}, 5: {1: "Loans", 3: 1020.0, 4: 1020.0},
    })
    notes = sheet("Notes", {
        0: {0: "Notes to the financial statements"},
        2: {0: "NOTE 9 : TRADE RECEIVABLES", 7: "As at 31 March 2026", 11: "As at 31 March 2025"},
        3: {0: "(Unsecured, considered good)"},
        4: {0: "From others", 7: 672.3, 11: 94.7},
        5: {0: "Total", 7: 672.3, 11: 94.7},
        7: {0: "NOTE 12 : LOANS"},
        8: {0: "Loans given to holding company", 7: 1020.0, 11: 1020.0},
        9: {0: "Allowance for doubtful loans", 7: 0.0, 11: 0.0},
        10: {0: "Total", 7: 1020.0, 11: 1020.0},
        # a later note lists the same loan among other classes: its lines name nothing for the loans table
        12: {0: "7. Fair value of financial assets"},
        13: {0: "Loans", 7: 1020.0, 11: 1020.0},
        14: {0: "Security deposits", 7: 0.0, 11: 0.0},
    })
    result = suggest(catalog_for("ind_as_taxonomy"), [bs, notes], CY, PY)
    by_cell = {(s["cell"]["sheet"], s["cell"]["ref"]): s for s in result.suggestions}
    current = {"axis": "ind-as:ClassificationBasedOnCurrentNoncurrentAxis", "member": "ind-as:CurrentMember"}
    good = {"axis": "ind-as:ClassificationOfAssetsBasedOnSecurityAxis", "member": "ind-as:UnsecuredConsideredGoodMember"}
    tr = [(a["concept"].split(":")[1], a["dims"]) for a in by_cell[("Balance Sheet", "D5")]["also"] if a["reason"] == "sub-classification"]
    # "Trade receivables, current" = "Trade receivables" + "Current"; the note says unsecured, considered good; no
    # allowance shown, so the gross amount is the same figure
    assert tr == [("TradeReceivables", [current]), ("TradeReceivables", [current, good]), ("TradeReceivablesGross", [current]), ("TradeReceivablesGross", [current, good])]
    loans = [(a["concept"].split(":")[1], a["dims"]) for a in by_cell[("Balance Sheet", "D6")]["also"] if a["reason"] == "sub-classification"]
    # the loans note names no security class (and the instruments note's "Security deposits" is not its evidence)
    assert loans == [("Loans", [current]), ("LoansGross", [current])]


def test_maturity_buckets_are_not_twelve_month_credit_losses():
    rows = {
        0: {0: "Maturities of financial assets", 9: "(Rs. in Lakh unless otherwise stated)"},
        2: {0: "Financial Assets", 3: "<12 months", 6: ">12 months", 9: "Total"},
        3: {0: "Trade Receivables", 3: 672.3, 6: 0.0, 9: 672.3},
        4: {0: "Loans", 3: 1020.0, 6: 0.0, 9: 1020.0},
        5: {0: "Total", 3: 1692.3, 6: 0.0, 9: 1692.3},
    }
    s = sheet("Notes", rows)
    assert suggest_tables(table_catalog_for("ind_as_taxonomy"), [s], [analyse_sheet(s, CY, PY)], CY, PY) == []


# ------------------------------------------------------------------ real data
real = pytest.mark.skipif(not (DGPL.exists() and DIXON.exists()), reason="real-data fixtures not present")


@real
def test_dixon_table_producer_floors():
    report, result = run_dgpl_dixon()
    t = report.by_producer["table"]
    produced = t["right"] + t["near"] + t["wrong"]
    print(report.text())
    # 117 on 2026-11-11 (PPE, changes in equity, financial assets by category with their fair values and category
    # totals, related parties)
    assert t["right"] >= 117, t
    assert t["wrong"] <= 0.1 * produced, t  # ADR-0013: table amounts wrong ≤ 10% of those produced
    assert t["extra"] <= 10, t
    also = report.by_producer["also"]  # "also report as" on sure statement tags: one class (2), sub-classification (16)
    assert also["right"] >= 18 and also["wrong"] == 0 and also["extra"] <= 4, also
    share = report.by_producer["share"]  # the share capital note: counts in its text, values, reconciliation, holders
    assert share["right"] >= 50 and share["wrong"] == 0 and share["extra"] == 0, share
    assert {b.table_id for b in result.blocks} == {"400600:DisclosureOfPropertyPlantAndEquipmentTable", "400200:StatementOfChangesInEquityTable",
                                                    "611100a:DisclosureOfFinancialAssetsTable", "610800:DisclosureOfTransactionsBetweenRelatedPartiesTable"}


@pytest.mark.skipif(not (HPL_KEY.exists() and any((ROOT / "data").glob("HPL*.xlsx"))), reason="HPL workbook not present")
def test_hpl_hand_checked_key_ci():
    r = run_key()
    print(r.text())
    assert len(r.right) >= 13 and not r.wrong and not r.missing, r.text()
