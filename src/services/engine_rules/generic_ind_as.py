"""Ind AS 2017 generic rules (Business Rules for IndAS Taxonomy V1.2, sheet "Generic rules") → engine handlers.

ELRs are named in the MCA text by title; they are resolved to codes of the built DTS here, and a title or element
that resolves to nothing fails the build (no silent gaps).
"""
from __future__ import annotations

from src.services.engine_rules.generic import _GUIDANCE, G, Handler
from src.services.engine_rules.resolver import Resolver
from src.services.engine_rules.workbook import Workbook, opening_closing_formulas


def _codes(A: dict, titles: list[str]) -> list[str]:
    out: list[str] = []
    for t in titles:
        codes = [e["code"] for e in A["elrs"] if e["title"] == t]
        if not codes:
            raise ValueError(f"Generic rule names an ELR the DTS does not have: '{t}'")
        out.extend(c for c in codes if c not in out)
    return out


def _locals(R: Resolver, names: list[str]) -> list[str]:
    """Local names of elements the taxonomy has (the engine matches exceptions by local name)."""
    missing = [n for n in names if not R.concept(n)]
    if missing:
        raise ValueError(f"Generic rule names elements the DTS does not have: {', '.join(missing)}")
    return list(names)


KMP = "Notes - Key managerial personnels and directors remuneration and other information"
SIGNATORIES = "Disclosures - Signatories of financial statements"
DIRECTORS = "Disclosures - Directors report"
SECRETARIAL = "Disclosures - Secretarial audit report"
CSR = "Notes - Corporate social responsibility"
AUDITORS = "Disclosures - Auditors report"
GENERAL = "Disclosure of general information about company"
CONSOLIDATED = "Notes - Consolidated Financial Statements"

GENERAL_ALLOWED = [
    "DisclosureOfCompanyInformationAbstract", "NameOfCompany", "CorporateIdentityNumber", "PermanentAccountNumberOfEntity",
    "AddressOfRegisteredOfficeOfCompany", "TypeOfIndustry", "PeriodCoveredByFinancialStatements", "DateOfStartOfReportingPeriod",
    "DateOfEndOfReportingPeriod", "NatureOfReportStandaloneConsolidated", "ContentOfReport", "DescriptionOfPresentationCurrency",
    "LevelOfRoundingUsedInFinancialStatements", "TypeOfCashFlowStatement",
]
DIRECTORS_PY_EXCEPTIONS = [
    "NumberOfSharesHeld", "NumberOfDematSharesHeld", "NumberOfPhysicalSharesHeld", "PercentageOfTotalSharesHeld",
    "PercentageOfSharesPledgedEncumberedToTotalShares", "PrincipalAmount", "InterestDueButNotPaid", "InterestAccruedButNotDue", "Indebtedness",
]
INR_EXEMPT = [
    "ShareCapitalOfSubsidiary", "ReservesAndSurplusOfSubsidiary", "TotalAssetsOfSubsidiary", "TotalLiabilitiesOfSubsidiary",
    "InvestmentOfSubsidiary", "TurnoverOfSubsidiary", "ProfitBeforeTaxOfSubsidiary", "ProvisionForTaxOfSubsidiary",
    "ProfitAfterTaxOfSubsidiary", "ProposedDividendOfSubsidiary", "NoncontrollingInterestsOfSubsidiary", "CurrentAssetsOfSubsidiary",
    "NoncurrentAssetsOfSubsidiary", "CurrentLiabilitiesOfSubsidiary", "NoncurrentLiabilitiesOfSubsidiary", "RevenueOfSubsidiary",
    "ComprehensiveIncomeOfSubsidiary", "ProfitLossAttributableToNoncontrollingInterests", "DividendsPaidToNoncontrollingInterests",
]
MULTI_AXIS_TABLES = [
    "DisclosureOfShareholdingMoreThanFivePerCentInCompanyTable", "ClassificationOfBorrowingsTable", "DisclosureOfPropertyPlantAndEquipmentTable",
    "DisclosureOfDetailedInformationAboutOtherIntangibleAssetsTable", "DetailsOfLoansTable", "DetailsOfAdvancesTable",
]
SPECIFIED_BANK_NOTES_TABLE = "DetailsOfSpecifiedBankNotesHeldAndTransactedDuringThePeriodFrom8November2016To30December2016Table"
SPECIFIED_BANK_NOTES_ELEMENTS = [
    "WhetherTheCompanyHadProvidedRequisiteDisclosuresInItsFinancialStatementsAsToHoldingsAsWellAsDealingsInSpecifiedBankNotesDuringThePeriodFrom8ThNovember2016To30ThDecember2016Explanatory",
    "WhetherTheseAreInAccordanceWithTheBooksOfAccountsMaintainedByTheCompanyExplanatory",
]


def prior_year(A: dict, R: Resolver, *_) -> dict:
    general, directors = _codes(A, [GENERAL])[0], _codes(A, [DIRECTORS])[0]
    if not any(t["hypercube"].split(":")[1] == SPECIFIED_BANK_NOTES_TABLE for t in A["tables"]):
        raise ValueError(f"GR-11 names a table the DTS does not have: {SPECIFIED_BANK_NOTES_TABLE}")
    return G(
        "elr-not-for-prior-year",
        codes=_codes(A, [AUDITORS, GENERAL, KMP, SIGNATORIES, DIRECTORS, CONSOLIDATED, SECRETARIAL, CSR]),
        exceptions={
            general: _locals(R, ["PeriodCoveredByFinancialStatements", "DateOfStartOfReportingPeriod", "DateOfEndOfReportingPeriod"]),
            directors: _locals(R, DIRECTORS_PY_EXCEPTIONS),
        },
        # parts of other ELRs that are not reported for the previous year (named by table / element in the MCA text)
        tables=[SPECIFIED_BANK_NOTES_TABLE],
        concepts=_locals(R, SPECIFIED_BANK_NOTES_ELEMENTS),
    )


def mandatory_axes(A: dict, R: Resolver, *_) -> dict:
    """"At least one child member shall be mandatory for all axis if table is present": every axis of the table."""
    tables: dict[str, list[str]] = {}
    for name in MULTI_AXIS_TABLES:
        axes = [a["axis"].split(":")[1] for t in A["tables"] if t["hypercube"].split(":")[1] == name for a in t["axes"]]
        if not axes:
            raise ValueError(f"GR-14 names a table the DTS does not have: {name}")
        tables[name] = list(dict.fromkeys(axes))
    return G("mandatory-axes", tables=tables)


def roll_forward(A: dict, R: Resolver, wb: Workbook) -> dict:
    """GR-6: closing balance = opening balance + change during the year, for each element of sheet "formulas
    Linkbase". Opening = previous-year closing is structural in the filing model (one instant context)."""
    formulas = opening_closing_formulas(wb)
    unparsed = [f for f in formulas if "unparsed" in f]
    if unparsed:
        raise ValueError(f"formulas Linkbase rows not in opening/change/closing form: {unparsed}")
    missing = [q for f in formulas for q in (f["balance"], f["change"]) if q not in A["concepts"]]
    if missing:
        raise ValueError(f"formulas Linkbase names elements the DTS does not have: {missing}")
    return G("opening-closing-roll-forward", pairs=[{"balance": f["balance"], "change": f["change"]} for f in formulas])


IND_AS_GENERIC: dict[int, Handler] = {
    1: lambda A, R, *_: G("calc-parent-child"),
    2: lambda A, R, *_: G("mandatory-line-items-driver"),
    3: lambda A, R, *_: G("sequential-members"),
    4: lambda A, R, *_: G("no-images"),
    5: lambda A, R, *_: G("cy-py-pairing", exemptElrCodes=[]),
    6: roll_forward,
    7: lambda A, R, *_: G("monetary-max-2-decimals"),
    8: lambda A, R, *_: G("inr-currency", exemptTables=[], exemptConcepts=[R.concept(n) for n in _locals(R, INR_EXEMPT)]),
    9: lambda A, R, *_: {
        "status": "REVIEW_ONLY_EXTERNAL_DATA", "implementation": "review:incorporation-date",
        "reason": "Date of incorporation is MCA21 master data; the Ind AS 2017 DTS has no date-of-incorporation element, so the instance cannot be checked against it",
    },
    10: lambda A, R, *_: G("elr-not-for-consolidated", codes=_codes(A, [KMP, SIGNATORIES, DIRECTORS, SECRETARIAL, CSR])),
    11: prior_year,
    12: lambda A, R, *_: {
        **G("general-info-consolidated", allowed=_locals(R, GENERAL_ALLOWED), elrCode=_codes(A, [GENERAL])[0]),
        "note": "Second sentence (values identical across the standalone and consolidated instance documents) needs the other instance: REVIEW_ONLY_EXTERNAL_DATA, reported by the engine as such.",
    },
    13: lambda A, R, *_: G("elr-not-for-standalone", codes=_codes(A, [CONSOLIDATED])),
    14: mandatory_axes,
    15: lambda A, R, *_: dict(_GUIDANCE),
    16: lambda A, R, *_: {
        **G("fta-opening-balance-sheet", flag=R.concept("WhetherCompanyHasAdoptedIndAsFirstTime"), elrCode=_codes(A, ["Balance sheet"])[0]),
        "note": "Not applicable to a company's first or second financial year; the filing model knows only the first (meta.firstFinancialYear).",
    },
}
