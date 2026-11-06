"""Example filing generator for testing, preview, and initial load."""

from __future__ import annotations
import re
from typing import Any, Dict, List, Optional, Set
from src.core.dimensions import nondim_allowed

DATES = {
    "DateOfBoardMeetingWhenFinalAccountsWereApproved": "2017-05-10",
    "DateOfSigningOfFinancialStatementsByDirector": "2017-05-10",
    "DateOfSigningOfFinancialStatementsByCompanySecretary": "2017-05-10",
    "DateOfSigningOfFinancialStatementsByChiefFinancialOfficer": "2017-05-10",
    "DateOfSigningOfFinancialStatementsByManager": "2017-05-10",
    "DateOfSigningOfBalanceSheetByAuditors": "2017-05-12",
    "DateOfSigningAuditReportByAuditors": "2017-05-12",
    "DateOfBoardOfDirectorsMeetingInWhichBoardReportReferredToUnderSection134WasApproved": "2017-05-10",
    "DateOfSigningBoardReport": "2017-05-10",
    "DateOfBirthOfKeyManagerialPersonnelOrDirector": "1970-01-01",
}

STRINGS = {
    "PermanentAccountNumberOfEntity": "AAACE1234A",
    "TypeOfIndustry": "Commercial and Industrial",
    "DescriptionOfPresentationCurrency": "INR",
    "SRNOfFormADT1": "Z99999999",
}


def sample_value(A: Any, c: str, seq: Optional[Dict[str, int]] = None) -> str:
    if seq is None:
        seq = {"pan": 0}
    c_info = A.concept(c)
    local = c_info.get("name") if c_info else ""
    t = A.data_type(c)
    if A.is_numeric(c):
        return "0"
    if t == "boolean":
        return "false"
    if local in DATES:
        return DATES[local]
    if local in STRINGS:
        return STRINGS[local]
    en = A.enumerations(c)
    if en:
        return en[0]
    if t == "date":
        return "2017-05-10"
    if re.search(r"^(PermanentAccountNumber|PAN)", local):
        seq["pan"] += 1
        return f"ABCDE{1000 + (seq['pan'] % 9000)}F"
    if "DirectorIdentificationNumber" in local:
        return "00012345"
    if local.startswith("CIN"):
        return "U72200KA2010PTC654321"
    if local.startswith("Country"):
        return "INDIA"
    if t == "textBlock":
        return "Nil"
    return "Sample"


sampleValue = sample_value


def complete_mandatory(S: Any, name: str = "Sample") -> Any:
    A = S.A
    q = lambda l: A.qname_of_local(l)
    seq = {"pan": 0}
    meta = S.filing.meta
    scopes = ["CY"] if meta.get("firstFinancialYear") else ["CY", "PY"]

    if not S.get_value(q("NameOfCompany"), "CY"):
        S.set_value(q("NameOfCompany"), "CY", name)
    if not S.get_value(q("TypeOfCashFlowStatement"), "CY"):
        S.set_value(q("TypeOfCashFlowStatement"), "CY", "Indirect Method")

    for r in A.rules.get("rules", []):
        if r.get("status") != "EXECUTABLE" or r.get("ast", {}).get("type") != "mandatory":
            continue
        ast = r["ast"]
        if ast.get("when") and not (ast["when"].get("op") == "reportType" and ast["when"].get("value") == meta.get("reportType")):
            continue
        c = ast.get("concept")
        if not nondim_allowed(A, c):
            continue  # dimensional: filled through its table below
        periods_allowed = r.get("scope", {}).get("periods") or ["CY", "PY"]
        for scope in periods_allowed:
            if scope not in scopes or not S.concept_status(c, scope).get("applicable") or S.get_value(c, scope):
                continue
            S.set_value(c, scope, sample_value(A, c, seq))

    if meta.get("reportType") == "Standalone":
        for scope in scopes:
            q_raised = q("WhetherMoneyRaisedFromPublicOfferingDuringYear")
            if q_raised:
                S.set_value(q_raised, scope, "false")

    for r in A.rules.get("rules", []):
        if r.get("status") != "EXECUTABLE" or r.get("ast", {}).get("type") != "tableRequired" or r.get("ast", {}).get("when"):
            continue
        for tid in r.get("ast", {}).get("tables", []):
            t = A.table(tid)
            if not t or not all(x.get("typed") for x in t.get("axes", [])):
                continue
            for scope in scopes:
                if not S.table_status(tid, scope).get("applicable"):
                    continue
                dims = [{"axis": x["axis"], "typed": "1"} for x in t.get("axes", [])]
                for c in t.get("lineItems", []):
                    c_info = A.concept(c)
                    if not c_info or c_info.get("abstract") or not S.concept_status(c, scope).get("applicable"):
                        continue
                    S.set_table_value(tid, scope, dims, c, sample_value(A, c, seq))

    return S


completeMandatory = complete_mandatory


def build_example(S: Any) -> None:
    A = S.A
    q = lambda l: A.qname_of_local(l)
    S.set_meta({
        "name": "Example Pvt Ltd (sample data)",
        "cin": "U72200KA2010PTC123456",
        "reportType": "Standalone",
        "level": "Actual",
        "displayPlaces": 0,
        "periods": {
            "cy": {"start": "2016-04-01", "end": "2017-03-31"},
            "py": {"start": "2015-04-01", "end": "2016-03-31"},
        },
    })
    S.set_value(q("NameOfCompany"), "CY", "Example Pvt Ltd")
    complete_mandatory(S, name="Example Pvt Ltd")

    bs = {
        "CurrentInvestments": [250000, 200000],
        "CurrentAssets": [250000, 200000],
        "Assets": [250000, 200000],
        "TradePayables": [250000, 200000],
        "CurrentLiabilities": [250000, 200000],
        "EquityAndLiabilities": [250000, 200000],
        "AggregateAmountOfQuotedCurrentInvestments": [0, 0],
        "AggregateAmountOfUnquotedCurrentInvestments": [250000, 200000],
        "AggregateProvisionForDiminutionInValueOfCurrentInvestments": [0, 0],
    }
    for l, (cy_val, py_val) in bs.items():
        q_item = q(l)
        if q_item:
            S.set_value(q_item, "CY", str(cy_val))
            S.set_value(q_item, "PY", str(py_val))

    T = "200500:DetailsOfCurrentInvestmentsTable"
    axis = q("ClassificationOfCurrentInvestmentsAxis")
    if axis and A.table(T):
        for scope, amt in (("CY", 250000), ("PY", 200000)):
            dims = [{"axis": axis, "typed": "CurrentInvestment1"}]
            type_q = q("TypeOfCurrentInvestments")
            class_q = q("ClassOfCurrentInvestments")
            cur_inv_q = q("CurrentInvestments")
            val_basis_q = q("BasisOfValuationOfCurrentInvestments")
            body_q = q("NameOfBodyCorporateInWhomInvestmentHasBeenMade")

            if type_q:
                S.set_table_value(T, scope, dims, type_q, "Investments in mutual funds")
            if class_q:
                enums = A.enumerations(class_q)
                if enums:
                    S.set_table_value(T, scope, dims, class_q, enums[0])
            if cur_inv_q:
                S.set_table_value(T, scope, dims, cur_inv_q, str(amt))
            if val_basis_q:
                S.set_table_value(T, scope, dims, val_basis_q, "Lower of cost and fair value")
            if body_q:
                S.set_table_value(T, scope, dims, body_q, "Sample Liquid Fund")


buildExample = build_example
