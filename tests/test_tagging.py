"""Auto-tagging units: layout analysis, candidate generation, assembly, LLM rerank plumbing (no network)."""
import datetime as dt

import pytest

from src.services.tagging.candidates import CandidateGenerator, MemoryItem
from src.services.tagging.catalog import catalog_for, statement_kind
from src.services.tagging.layout import analyse_sheet
from src.services.tagging.rerank import RerankChoice, RerankItem, RerankOption, build_messages, parse_choices
from src.services.tagging.suggest import SuggestOptions, suggest
from src.services.tagging.text import header_dates, norm_label, qualifier, scale_of

CY, PY = dt.date(2026, 3, 31), dt.date(2025, 3, 31)


def sheet(name: str, rows: dict[int, dict[int, object]]) -> dict:
    return {"name": name, "cells": [{"r": r, "c": c, "v": v} for r, cols in rows.items() for c, v in cols.items()]}


# columns: A markers · B labels · C indented labels · D note no. · E CY · F PY · G a stale 2019 column
A, B, C, D, E, F, G = range(7)
BS = sheet("Balance Sheet", {
    0: {B: "BALANCE SHEET AS AT 31ST MARCH, 2026"},
    1: {G: "(Rs. in Lakh unless otherwise stated)"},
    2: {B: "Particulars", D: "Note No.", E: "As at 31st March 2026", F: "As at 31st March 2025", G: "As at 30th September, 2019"},
    4: {B: "NON-CURRENT ASSETS"},
    5: {B: "Property, Plant & Equipment", D: 5, E: 10.0, F: 12.0, G: 99.0},
    6: {B: "Intangible assets"},  # a line with no figures: not a heading for what follows
    7: {D: "A", E: 10.0, F: 12.0},  # an unlabelled subtotal
    8: {B: "Other Financial Assets", D: 6, E: 3.0, F: 4.0},
    10: {B: "CURRENT ASSETS"},
    11: {B: "Financial Assets"},
    12: {C: "Trade Receivables", D: 8, E: 50.0, F: 40.0},
    13: {B: "Other Current Assets", D: 9, E: 5.0, F: 6.0},
    14: {C: "TOTAL ASSETS", E: 68.0, F: 62.0},
    16: {B: "CURRENT LIABILITIES"},
    17: {A: "IV", C: "Trade Payables", D: 18},
    18: {C: "Outstanding dues of micro and small enterprises", E: 0.0, F: 0.0},
    # row 19 is blank: a heading with a note number survives it, a plain heading wouldn't
    20: {C: "Outstanding dues of others", E: 8.0, F: 7.0},
    21: {C: "TOTAL EQUITY & LIABILITIES", E: 68.0, F: 62.0},
    24: {B: "As per our report of even date"},
    25: {F: "DIN-07339035"},
    29: {E: -0.0018, F: -0.0002},  # a footing check below the signatures
})


# ---------------------------------------------------------------- text
def test_text_helpers():
    assert norm_label("(ii) Trade Receivables - Non Current") == "trade receivables noncurrent"
    assert header_dates("As at \n31st March 2026") == [CY]
    assert scale_of("(Rs. in Lakh unless otherwise stated)") == "Lakhs"
    assert qualifier("Trade Receivables", ["CURRENT ASSETS", "Financial Assets"]) == "current"
    assert qualifier("In Current Accounts", []) is None


def test_statement_kind_from_elr_title():
    assert statement_kind("Balance sheet") == "balance_sheet"
    assert statement_kind("Statement of profit and loss") == "profit_loss"
    assert statement_kind("Cash flow statement, indirect") == "cash_flow"
    assert statement_kind("Notes - Cash flow statement") == "notes"
    assert statement_kind("Statement of changes in equity") == "equity"


# ---------------------------------------------------------------- layout
def test_layout_columns_scale_and_kind():
    layout = analyse_sheet(BS, CY, PY)
    assert layout.kind == "balance_sheet" and layout.scale == "Lakhs"
    assert layout.period_columns == {"CY": "E", "PY": "F"}  # the stale 2019 column is not a period
    assert all(r.period_type == "instant" for r in layout.rows)


def test_layout_totals_keep_their_own_name():
    labels = [r.label for r in analyse_sheet(BS, CY, PY).rows]
    assert "TOTAL ASSETS" in labels and "TOTAL EQUITY & LIABILITIES" in labels
    assert "Total non-current assets" in labels  # the unlabelled "A" subtotal takes its section's name


def test_layout_headings_scope():
    rows = {r.label: r for r in analyse_sheet(BS, CY, PY).rows}
    # a figure-less line ("Intangible assets") ends at the subtotal: it isn't the next row's heading
    assert rows["Other Financial Assets"].context == ["NON-CURRENT ASSETS"]
    assert rows["Trade Receivables"].context == ["CURRENT ASSETS", "Financial Assets"]
    # a line with its own note number closes the sibling heading at its column
    assert rows["Other Current Assets"].context == ["CURRENT ASSETS"]
    assert rows["Outstanding dues of others"].context == ["CURRENT LIABILITIES", "Trade Payables"]
    assert rows["TOTAL ASSETS"].context == []


def test_layout_stops_at_the_signature_block():
    rows = analyse_sheet(BS, CY, PY).rows
    assert not any(r.label.lower().startswith(("din", "total din")) for r in rows)
    assert max(r.r for r in rows) == 21


# ---------------------------------------------------------------- candidates
@pytest.fixture(scope="module")
def ind_as():
    return catalog_for("ind_as_taxonomy")


def test_catalog_keeps_only_taggable_numeric_elements(ind_as):
    assert "ind-as:TradeReceivablesCurrent" in ind_as.concepts
    assert "ind-as:NameOfCompany" not in ind_as.concepts  # text
    assert all(info.data_type in {"monetary", "decimal", "shares", "perShare", "percent", "pure"} for info in ind_as.concepts.values())


def test_qualifier_from_heading_beats_the_classless_element(ind_as):
    layout = analyse_sheet(BS, CY, PY)
    gen = CandidateGenerator(ind_as)
    rows = {r.label: r for r in layout.rows}
    best = gen.for_row(rows["Trade Receivables"], "balance_sheet").best
    assert best.qname == "ind-as:TradeReceivablesCurrent" and best.origin == "exact" and best.confidence >= 0.9
    other = gen.for_row(rows["Other Financial Assets"], "balance_sheet").best
    assert other.qname == "ind-as:OtherNoncurrentFinancialAssets"
    assert gen.for_row(rows["TOTAL ASSETS"], "balance_sheet").best.qname == "ind-as:Assets"


def test_period_type_filter(ind_as):
    layout = analyse_sheet(BS, CY, PY)
    gen = CandidateGenerator(ind_as)
    for rc in (gen.for_row(r, "balance_sheet") for r in layout.rows):
        assert all(ind_as.concepts[c.qname].period_type == "instant" for c in rc.candidates)


def test_memory_wins_and_unknown_concepts_are_ignored(ind_as):
    rows = {r.label: r for r in analyse_sheet(BS, CY, PY).rows}
    gen = CandidateGenerator(ind_as, [
        MemoryItem("trade receivables", "ind-as:TradeReceivablesCurrent", 3),
        MemoryItem("Other Current Assets", "in-gaap:NotInThisTaxonomy", 9),
    ])
    best = gen.for_row(rows["Trade Receivables"], "balance_sheet").best
    assert best.origin == "memory" and best.confidence > 0.97
    assert gen.for_row(rows["Other Current Assets"], "balance_sheet").best.origin != "memory"


def test_suggest_assembles_cells_and_one_fact_per_cell(ind_as):
    res = suggest(ind_as, [BS], CY, PY)
    by_ref = {s["cell"]["ref"]: s for s in res.suggestions}
    assert by_ref["E13"]["concept"] == by_ref["F13"]["concept"] == "ind-as:TradeReceivablesCurrent"
    assert (by_ref["E13"]["scope"], by_ref["F13"]["scope"]) == ("CY", "PY")
    assert "G6" not in by_ref  # the 2019 column is never suggested
    keys = [(s["concept"], s["scope"]) for s in res.suggestions]
    assert len(keys) == len(set(keys)), "one fact comes from one cell"
    assert all(0 < s["confidence"] <= 1 and s["rationale"] for s in res.suggestions)


# ---------------------------------------------------------------- rerank (no network)
class FakeReranker:
    def __init__(self, pick):
        self.pick, self.items = pick, []

    def rerank(self, items):
        self.items = items
        return {it.id: RerankChoice(self.pick(it), 0.88, "fits the heading") for it in items}


def test_rerank_only_sees_labels_and_may_only_pick_offered_concepts(ind_as):
    fake = FakeReranker(lambda it: it.options[-1].qname)
    res = suggest(ind_as, [BS], CY, PY, options=SuggestOptions(use_llm=True), reranker=fake)
    assert fake.items, "undecided rows go to the reranker"
    payload = str(build_messages(fake.items))
    assert "50.0" not in payload and "Balance Sheet" not in payload  # no amounts, no sheet names
    ai = [s for s in res.suggestions if s["origin"] == "ai"]
    assert ai and all(s["rationale"].startswith("AI:") for s in ai)
    assert res.llm_used


def test_parse_choices_drops_invented_concepts():
    items = [RerankItem(1, "Loans", [], "balance_sheet", [RerankOption("ind-as:LoansCurrent", "Loans, current", "instant", "debit")])]
    text = '{"rows":[{"id":1,"concept":"ind-as:Invented","confidence":0.9},{"id":7,"concept":null}]}'
    assert parse_choices(text, items) == {}
    ok = parse_choices('{"rows":[{"id":1,"concept":"ind-as:LoansCurrent","confidence":1.5,"reason":"x"}]}', items)
    assert ok[1].qname == "ind-as:LoansCurrent" and ok[1].confidence == 0.9  # capped
    assert parse_choices("not json", items) == {}
