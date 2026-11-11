"""Generic rules → engine handlers (``engine/src/core/rules.js``), per taxonomy.

The workbooks number their generic rules differently (Ind AS has no "parent member mandatory" rule, so its
numbers shift by one, and it adds a first-time-adoption rule), so each taxonomy has its own map from the
workbook's rule number to a handler.
"""
from __future__ import annotations

from typing import Callable

from src.services.engine_rules.resolver import Resolver

Handler = Callable[..., dict]  # (A, R, workbook) -> rule body


def G(impl: str, **extra) -> dict:
    return {"status": "EXECUTABLE", "implementation": f"generic:{impl}", "ast": {"type": "generic", "handler": impl, **extra}}


def _opening_closing(A: dict, R: Resolver, *_) -> dict:
    return {**G("opening-equals-prior-closing"), "note": "Structural: opening (current) and closing (previous) share one instant context, so they cannot diverge; the engine also verifies imported duplicates."}


_GUIDANCE = {"status": "NOT_APPLICABLE", "reason": "Guidance on completeness of reporting; not machine-checkable against the instance"}

CI_GENERIC: dict[int, Handler] = {
    1: lambda A, R, *_: G("calc-parent-child"),
    2: lambda A, R, *_: G("mandatory-line-items-driver"),
    3: lambda A, R, *_: G("dimension-parent-child-members", excludedLineItems=[q for q in (R.concept(n) for n in [
        "DescriptionOfNatureAndPurposeOfOtherReserves", "NatureOfOtherLoansAndAdvances", "NatureOfOtherInventories",
        "NatureOfOtherTangibleAssets", "NatureOfOtherIntangibleAssets"]) if q]),
    4: lambda A, R, *_: G("sequential-members"),
    5: lambda A, R, *_: G("no-images"),
    6: lambda A, R, *_: G("cy-py-pairing", exemptElrCodes=["201900"]),
    7: _opening_closing,
    8: lambda A, R, *_: G("monetary-max-2-decimals"),
    9: lambda A, R, *_: G("inr-currency", exemptTables=R.tables_by_hc("DetailsOfSubsidiariesTable") + R.tables_by_hc("DisclosureOfDetailsOfSubsidiariesTable")),
    10: lambda A, R, *_: {"status": "REVIEW_ONLY_EXTERNAL_DATA", "implementation": "review:incorporation-date", "reason": "Date of incorporation is MCA21 master data; the C&I 2016 DTS has no date-of-incorporation element, so the instance cannot be checked against it"},
    11: lambda A, R, *_: G("elr-not-for-consolidated", codes=["202800", "300700", "400300", "400400", "202300", "202400", "202500", "400500", "301000"]),
    12: lambda A, R, *_: G(
        "elr-not-for-prior-year",
        codes=["400200", "202400", "202500", "400100", "202800", "300700", "400300", "400400", "202300", "202600", "400500", "301000"],
        exceptions={
            "400100": ["PeriodCoveredByFinancialStatements", "DateOfStartOfReportingPeriod", "DateOfEndOfReportingPeriod"],
            "400400": ["NumberOfSharesHeld", "NumberOfDematSharesHeld", "NumberOfPhysicalSharesHeld", "PercentageOfTotalSharesHeld", "PercentageOfSharesPledgedEncumberedToTotalShares", "PrincipalAmount", "InterestDueButNotPaid", "InterestAccruedButNotDue", "Indebtedness"],
        },
    ),
    13: lambda A, R, *_: {**G("general-info-consolidated", allowed=[
        "DisclosureOfCompanyInformationAbstract", "NameOfCompany", "CorporateIdentityNumber", "PermanentAccountNumberOfEntity",
        "AddressOfRegisteredOfficeOfCompany", "TypeOfIndustry", "PeriodCoveredByFinancialStatements", "DateOfStartOfReportingPeriod",
        "DateOfEndOfReportingPeriod", "NatureOfReportStandaloneConsolidated", "ContentOfReport", "DescriptionOfPresentationCurrency",
        "LevelOfRoundingUsedInFinancialStatements", "TypeOfCashFlowStatement"]),
        "note": "Second sentence (values identical across the standalone and consolidated instance documents) needs the other instance: REVIEW_ONLY_EXTERNAL_DATA, reported by the engine as such."},
    14: lambda A, R, *_: G("elr-not-for-standalone", codes=["202600"]),
    15: lambda A, R, *_: G("mandatory-axes", tables={
        "DisclosureOfShareholdingMoreThanFivePerCentInCompanyTable": ["ClassesOfShareCapitalAxis", "NameOfShareholderAxis"],
        "ClassificationOfBorrowingsTable": ["ClassificationBasedOnTimePeriodAxis", "ClassificationOfBorrowingsAxis", "SubclassificationOfBorrowingsAxis"],
        "DisclosureOfTangibleAssetsTable": ["ClassesOfTangibleAssetsAxis", "CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis"],
        "DisclosureOfIntangibleAssetsTable": ["ClassesOfIntangibleAssetsAxis", "CarryingAmountAccumulatedAmortizationAndImpairmentAndGrossCarryingAmountAxis"],
        "LoansAndAdvancesTable": ["ClassificationBasedOnTimePeriodAxis", "ClassificationOfLoansAndAdvancesAxis", "ClassificationOfAssetsBasedOnSecurityAxis"],
    }),
    16: lambda A, R, *_: dict(_GUIDANCE),
    17: lambda A, R, *_: G("taxonomy-period-applicability", **{"from": "2014-04-01"}),
}

