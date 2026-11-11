"""Executable business rules built in Python from the MCA rule workbooks (ADR-0011) and the /{id}/engine-rules route."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import app
from src.services.engine_rules.builder import apply_curation, build, measure
from src.services.engine_rules.jsre import ji, trim
from src.services.engine_rules.sheet_origin import sheet_origins
from src.services.engine_rules.specific import split_clauses
from src.services.engine_rules.specs import CI_2016, RULE_SPECS
from src.services.engine_rules.workbook import generic_rules, mandatory_line_item_sheets, read_workbook, specific_rules

client = TestClient(app)
FIXTURES = Path(__file__).parent / "fixtures" / "engine_rules"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built():
    """Each taxonomy built once for the module: {id: (rules, coverage)}."""
    return {tid: build(spec) for tid, spec in RULE_SPECS.items()}


# ------------------------------------------------------------------------------------------------- golden
def test_ci_rules_equal_the_frozen_typescript_output(built):
    """The Python port builds exactly the rule model the retired TS compiler built (same keys, same order)."""
    rules, coverage = built["ci_taxonomy"]
    golden = load(FIXTURES / "ci_rules.ts-golden.json")
    assert json.dumps(rules["businessRules"]) == json.dumps(golden["businessRules"])
    for k in ("taxonomyId", "taxonomyHash", "acceptedSchemaRefs"):
        assert rules["meta"][k] == golden["meta"][k], k


def test_ci_coverage_equals_the_frozen_typescript_output(built):
    _, coverage = built["ci_taxonomy"]
    golden = load(FIXTURES / "ci_coverage.ts-golden.json")
    ours = {k: v for k, v in coverage.items() if k not in ("generatedBy", "measure")}
    theirs = {k: v for k, v in golden.items() if k != "generatedBy"}
    assert json.dumps(ours) == json.dumps(theirs)


@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_committed_files_are_current_and_deterministic(built, tid):
    """Rebuilding gives exactly the committed files (run `make engine-rules` after changing the builder)."""
    spec = RULE_SPECS[tid]
    rules, coverage = built[tid]
    assert rules == load(spec.rules_file)
    assert coverage == load(spec.coverage_file)


@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_rules_are_tied_to_the_committed_taxonomy_build(built, tid):
    rules, _ = built[tid]
    assert rules["meta"]["taxonomyHash"] == load(RULE_SPECS[tid].authority_file)["meta"]["taxonomyHash"]
    assert rules["meta"]["compilerVersion"] == "3.0.0"
    assert all(not s["file"].startswith("engine/compiler") for s in rules["meta"]["sources"])


# ------------------------------------------------------------------------------------------------- coverage
@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_executable_share_meets_the_bar(built, tid):
    """ADR-0011: EXECUTABLE ÷ (all − NOT_APPLICABLE) ≥ 95%, review-only and unimplemented reported separately."""
    _, coverage = built[tid]
    m = coverage["measure"]
    s = coverage["summary"]
    assert m["denominator"] == sum(s.values()) - s.get("NOT_APPLICABLE", 0)
    assert m["executable"] + m["reviewOnly"] + m["unimplemented"] == m["denominator"]
    assert m["executableShare"] >= 0.95, m


def test_ci_measure_values(built):
    m = built["ci_taxonomy"][1]["measure"]
    assert (m["rules"], m["notApplicable"], m["executable"], m["reviewOnly"], m["unimplemented"]) == (1164, 153, 962, 48, 1)
    assert m["executableShare"] == 0.9515


def test_ind_as_measure_and_remaining_gaps(built):
    """The two Ind AS clauses left unformalized, each for a stated reason (coverage report "Missing")."""
    _, coverage = built["ind_as_taxonomy"]
    m = coverage["measure"]
    assert (m["executable"], m["reviewOnly"], m["unimplemented"]) == (1273, 60, 2)
    missing = {r["ruleId"] for r in coverage["rules"] if r["status"] == "UNIMPLEMENTED"}
    assert missing == {"SR-L4235-1", "ML-39-b"}  # "selected in above element" (unnamed); outstanding balances (ambiguous, as C&I ML-20-b)


def test_ind_as_reader_and_generic_rules(built):
    rules, coverage = built["ind_as_taxonomy"]
    wb = read_workbook(RULE_SPECS["ind_as_taxonomy"].workbook)
    rows = RULE_SPECS["ind_as_taxonomy"].specific_rules(wb).rows
    assert len(rows) == 812 and all(r.prefix in ("ind-as", "in-ca") for r in rows)
    generic = {r["id"]: r for r in rules["businessRules"]["rules"] if r["family"] == "generic"}
    assert len(generic) == 16
    assert generic["GR-6"]["ast"]["handler"] == "opening-closing-roll-forward"
    assert len(generic["GR-6"]["ast"]["pairs"]) == 36
    assert generic["GR-11"]["ast"]["codes"] == ["700400", "700300", "700100", "700500", "700600", "613400", "700700", "700200"]
    assert generic["GR-12"]["ast"]["elrCode"] == "700300"
    assert generic["GR-9"]["status"] == "REVIEW_ONLY_EXTERNAL_DATA"
    assert generic["GR-15"]["status"] == "NOT_APPLICABLE"


def test_fallback_never_changes_what_the_main_pass_formalizes(built):
    """C&I has no specific clause the main pass leaves unformalized, so the second pass never touches it."""
    _, coverage = built["ci_taxonomy"]
    assert not [r for r in coverage["rules"] if r["family"] == "specific" and r["status"] == "UNIMPLEMENTED"]


def test_ind_as_curation_entries_carry_their_evidence():
    entries = load(RULE_SPECS["ind_as_taxonomy"].curation_dir / "divergences.json")["rules"]
    assert entries
    for d in entries:
        assert d["ruleText"] and d["instanceFact"] and "MCA-accepted Dixon" in d["evidence"], d["ruleId"]


@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_every_clause_has_one_status_and_a_reason_when_not_executed(built, tid):
    _, coverage = built[tid]
    ids = set()
    for r in coverage["rules"]:
        assert r["status"] in {"EXECUTABLE", "REVIEW_ONLY_EXTERNAL_DATA", "UNIMPLEMENTED", "NOT_APPLICABLE"}, r["ruleId"]
        assert r["ruleId"] not in ids
        ids.add(r["ruleId"])
        assert r["sourceText"] and r["sourceRow"], r["ruleId"]
        if r["status"] == "EXECUTABLE":
            assert r["implementation"], r["ruleId"]
        else:
            assert r["reason"], r["ruleId"]


@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_every_specific_rule_row_is_represented(built, tid):
    spec = RULE_SPECS[tid]
    _, coverage = built[tid]
    rows = spec.specific_rules(read_workbook(spec.workbook)).rows
    covered = {(r["sourceSheet"], r["sourceRow"]) for r in coverage["rules"]}
    assert rows and all((row.sheet, row.line) in covered for row in rows)


@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_coverage_report_is_generated(tid):
    spec = RULE_SPECS[tid]
    text = spec.report_file.read_text(encoding="utf-8")
    assert text.startswith(f"# Rule coverage · {spec.title}")
    assert "**Executable share**" in text and "## Missing (backlog)" in text


# ------------------------------------------------------------------------------------------------- reader
def test_ci_workbook_corpus_inventory():
    """Port of the legacy corpus test: the complete original workbook is read, nothing truncated."""
    wb = read_workbook(CI_2016.workbook)
    assert wb.form == "workbook"
    names = [s.name for s in wb.sheets]
    for n in ["Changes to Business Rules", "Specific rules for elements", "Generic rules", "Applicable ELR", "Mandatory Line Items",
              "Exempt parent member Dimension", "Exempt Child Member Dimension", "Parent Child Exempt Calculation", "Country Codes"]:
        assert n in names
    spec = specific_rules(wb)
    assert not spec.truncated and all(not s.truncated for s in wb.sheets)
    assert len(spec.rows) == 567
    assert len(generic_rules(wb)) == 17
    assert len(mandatory_line_item_sheets(wb)[0]["rows"]) == 44
    assert spec.last_elr.code == "400500"


def test_lines_count_from_the_stored_sheet_range():
    """Rule ids carry the line; it counts from the sheet's stored range (BIFF DIMENSIONS), not the first value."""
    origins = sheet_origins(CI_2016.workbook)
    assert origins["Specific rules for elements"] == (1, 0)
    assert origins["Exempt parent member Dimension"] == (0, 0)  # row 1 is a formatted blank row
    assert origins["Parent child exempt-calculation"] == (1, 1)


def test_js_compatible_regex_and_trim():
    assert trim("﻿\xa0 x 　") == "x"
    assert ji(r"^a\s+b$").search("A\xa0b")  # JS \s matches NBSP
    assert not ji(r"^ab$").search("ab\n")  # JS $ does not match before a final newline
    assert not ji(r"^\w+$").search("é")  # JS \w is ASCII


def test_split_clauses():
    # sentences joined without a space are split only after "%" or "zero" (as the MCA text has them)
    assert split_clauses("Should be greater than or equal to zero.This field is mandatory.") == [
        "Should be greater than or equal to zero", "This field is mandatory"]
    assert split_clauses("This is a mandatory field. Should be greater than or equal to zero") == [
        "This is a mandatory field", "Should be greater than or equal to zero"]
    assert split_clauses("Should be less than or equal to 100%.Mandatory if 'X' is yes") == [
        "Should be less than or equal to 100%", "Mandatory if 'X' is yes"]


# ------------------------------------------------------------------------------------------------- curation
def _tiny():
    model = {"rules": [
        {"id": "SR-L1-1", "status": "EXECUTABLE", "ast": {"type": "mandatory"}},
        {"id": "ML-1", "status": "EXECUTABLE", "ast": {"type": "lineItemsMandatory", "concepts": ["a:A", "a:B"]}},
        {"id": "ML-2-b", "status": "UNIMPLEMENTED"},
    ]}
    coverage = {"rules": [{"ruleId": r["id"]} for r in model["rules"]], "summary": {"EXECUTABLE": 2, "UNIMPLEMENTED": 1}}
    return model, coverage


def test_curation_downgrades_with_evidence_and_rejects_unknown_rules():
    model, coverage = _tiny()
    apply_curation(model, coverage, {"rules": [{"ruleId": "SR-L1-1", "evidence": "accepted by MCA"},
                                              {"ruleId": "ML-1", "concepts": ["a:B"], "evidence": "B omitted, accepted"}]},
                   [{"kind": "rule", "id": "ML-2-b", "approved": True, "description": "ambiguous"}])
    assert model["rules"][0]["severity"] == "WARNING" and model["rules"][0]["divergence"] == "accepted by MCA"
    assert model["rules"][1]["ast"]["softConcepts"] == ["a:B"]
    assert model["rules"][2]["approvedLimitation"] == {"approvedBy": None, "description": "ambiguous"}
    assert coverage["rules"][2]["approvedLimitation"] == "APPROVED LIMITATION / NOT EXECUTED"
    assert measure(coverage)["approvedLimitations"] == 1
    with pytest.raises(ValueError, match="unknown rule"):
        apply_curation(*_tiny(), {"rules": [{"ruleId": "SR-L9-9", "evidence": "x"}]}, [])
    with pytest.raises(ValueError, match="no such mandatory elements"):
        apply_curation(*_tiny(), {"rules": [{"ruleId": "ML-1", "concepts": ["a:Z"], "evidence": "x"}]}, [])
    with pytest.raises(ValueError, match="not an UNIMPLEMENTED rule"):
        apply_curation(*_tiny(), {"rules": []}, [{"kind": "rule", "id": "SR-L1-1", "approved": True, "description": "x"}])


# ------------------------------------------------------------------------------------------------- route
@pytest.mark.parametrize("tid", list(RULE_SPECS))
def test_engine_rules_route(tid):
    resp = client.get(f"/api/v1/taxonomies/{tid}/engine-rules")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True and body["message"] == "Executable business rules"
    assert body["data"]["meta"]["taxonomyHash"] == load(RULE_SPECS[tid].rules_file)["meta"]["taxonomyHash"]
    assert len(body["data"]["businessRules"]["rules"]) > 500


@pytest.mark.parametrize("tid", ["costing_taxonomy", "nope"])
def test_engine_rules_route_without_rules(tid):
    resp = client.get(f"/api/v1/taxonomies/{tid}/engine-rules")
    assert resp.status_code == 404
    assert resp.json()["success"] is False
