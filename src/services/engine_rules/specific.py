"""Specific rules for elements: one MCA sentence → one executable AST, or a reasoned status.

Port of ``formalizeSpecific`` / ``formalizeExtended`` / ``parseCondition`` / ``splitClauses`` from
``engine/compiler/rule-formalizer.mjs``. The order of the checks is the order of the original: a sentence
gets the first formalization that matches, so the order must not change.

Every clause receives exactly one status:
  EXECUTABLE                 formalized; executed by engine/src/core/rules.js
  REVIEW_ONLY_EXTERNAL_DATA  needs data that is not in the instance (MCA21 master data, another instance)
  NOT_APPLICABLE             no executable content in this taxonomy
  UNIMPLEMENTED              not (yet) formalized
A formalization is a text pattern (``pattern:<id>``) or a curated one (``curated:<id>``) for a single sentence.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from src.services.engine_rules.jsre import ji, js, trim, collapse_ws
from src.services.engine_rules.model import (
    SELF, cmp, const, entered, executable, is_nondim_only, nd,
)
from src.services.engine_rules.resolver import Resolver
from src.services.engine_rules.workbook import SpecificRow


@dataclass(frozen=True)
class Context:
    """What the formalizer needs besides the sentence."""

    A: dict
    R: Resolver
    dts: str  # "C&I 2016" — named in NOT_APPLICABLE reasons


# ------------------------------------------------------------------------------------------------- clauses
_QUALIFIER = ji(r"^(However, in case the first level child|To validate this|For validating this|In case of multiple dates|For eg)")
_JOINED = js(r"(%|zero)\.(?=(?:Mandatory|This|Should)\b)")
_IS_YES = js(r"\bis Yes (?=Value entered here)")
_SPLIT = js(
    r"(?<=[.'\"%])\s+(?=(?:Should|Mandatory|This|It|Summation|Either|YES|Valid|Status|But|In case|To validate|For validating|However|Total)\b)|(?<=\.)\s+(?=[A-Z])"
)
_TAIL = js(r"[\s.]+$")


def split_clauses(text: str) -> list[str]:
    t = trim(collapse_ws(text))
    # sentences joined without a space ("...100%.Mandatory if", "...zero.This field")
    t = _JOINED.sub(r"\1. ", t)
    # C&I row 3610: "... is Yes Value entered here should be 2 percent ..." (two sentences, no stop)
    t = _IS_YES.sub("is Yes. ", t, count=1)
    out: list[str] = []
    for p in _SPLIT.split(t):
        p = trim(_TAIL.sub("", trim(p), count=1))
        if not p:
            continue
        if _QUALIFIER.search(p) and out:
            out[-1] += ". " + p
        else:
            out.append(p)
    return out


# ------------------------------------------------------------------------------------------------- data
Q = r"""['"]([^'"]+)['"]"""
QQ = r"""['"]\s*([^'"]+?)\s*['"]"""
# "... mandatory ..." heads used across the workbook
MAND_HEAD = (
    r"(?:Mandatory(?: to enter)?|Shall be mandatory|Should be mandatory|Table should be mandatory|Table is mandatory|"
    r"This (?:is a |is )?mandatory(?: field| item| element)?|This (?:field|item|element|table|Table) (?:is|will be|becomes) "
    r"(?:mandatory|Mandatory|mandtory))"
)

# "Mandatory if corresponding Number of shares is entered and vice-a-versa": the corresponding number-of-shares
# element occupies the parallel position in the C&I [200100] increase/decrease presentation blocks.
AMOUNT_NUMBER_PAIRS = {
    "AmountOfPublicIssueDuringPeriod": "NumberOfSharesIssuedInPublicOffering",
    "AmountOfBonusIssueDuringPeriod": "NumberOfSharesIssuedAsBonusShares",
    "AmountOfRightsIssueDuringPeriod": "NumberOfSharesIssuedAsRights",
    "AmountOfOtherPrivatePlacementIssueDuringPeriod": "NumberOfSharesIssuedInOtherPrivatePlacement",
    "AmountOfOtherPreferentialAllotmentIssueDuringPeriod": "NumberOfSharesIssuedAsOtherPreferentialAllotment",
    "AmountOfIssueAllottedForContractsWithoutPaymentReceivedInCashDuringPeriod": "NumberOfSharesAllottedForContractsWithoutPaymentReceivedInCash",
    "AmountOfIssueUnderSchemeOfAmalgamationDuringPeriod": "NumberOfSharesIssuedUnderSchemeOfAmalgamation",
    "AmountOfOtherIssuesDuringPeriod": "NumberOfOtherIssuesOfShares",
    "AmountOfOtherIssueArisingOutOfConversionOfSecuritiesDuringPeriod": "NumberOfOtherIssueOfSharesArisingOutOfConversionOfSecurities",
    "DecreaseInAmountOfSharesRedeemed": "NumberOfSharesRedeemed",
    "DecreaseInAmountOfSharesBoughtBack": "NumberOfSharesBoughtBack",
    "OtherDecreaseInAmountOfShares": "OtherDecreaseInNumberOfShares",
    "DecreaseInShareCapitalDuringPeriod": "DecreaseInNumberOfSharesDuringPeriod",
    # Ind AS [400100]: the same parallel positions in the increase/decrease blocks
    "AmountOfShareBasedPaymentTransactionsDuringPeriod": "NumberOfSharesIssuedInSharesBasedPaymentTransactions",
    "DecreaseInAmountOfTreasurySharesOrSharesBoughtBack": "NumberOfSharesBoughtBackOrTreasuryShares",
    "DecreaseInEquityShareCapitalDuringPeriod": "DecreaseInNumberOfSharesDuringPeriod",
}

# Each family is a literal reading of the MCA sentence; anything needing data outside the instance is
# REVIEW_ONLY_EXTERNAL_DATA, anything without an executable constraint is NOT_APPLICABLE.
EXTERNAL = [
    (ji(r"^Name (?:of the company )?should be based on"), "Name must match the MCA21 master record of the CIN/DIN entered — master data is not part of the instance document"),
    (ji(r"^If value of .DesignationOfKeyManagerialPersonnelOrDirector. is one of the below then Name should be"), "Name must match the MCA21 DIN/PAN master record — master data is not part of the instance document"),
    (ji(r"^Should be valid DIN$"), "DIN validity is established against the MCA21 DIN register, which is not part of the instance document"),
    (ji(r"associated with (?:the )?compan"), "Association of the person with the company is established from MCA21 master data, which is not part of the instance document"),
    (ji(r"^Should be same as entered in the Form"), "Comparison with the e-form (AOC-4 XBRL) in which the instance is attached; the form is not part of the instance document"),
    (ji(r"^(?:Valid SRN|Should be valid SRN|Should belong to CIN of subsidiary company|Z99999999 should be entered only)"), "SRN validity/ownership is established from MCA21 filing records, which are not part of the instance document"),
    (ji(r"(?:ICAI|ICSI) database"), "Validity is established against the ICAI/ICSI member database, which is not part of the instance document"),
    (ji(r"^Status of the company"), "Requires company class from MCA21 company master data, which is not part of the instance document"),
    (ji(r"in case of OPC, 2 in case of private company"), "Requires company class (OPC/Private/Public/Producer) from MCA21 company master data, which is not part of the instance document"),
    (ji(r"currency code as per the list of currency codes"), "The list of currency codes is not part of the MCA authority package (workbook sheets, taxonomy, Filing Manual)"),
    (ji(r"ITC/NPCS"), "The ITC/NPCS product code master is not part of the MCA authority package"),
]
NO_CONSTRAINT = [
    (ji(r"^This can be less than the date of incorporation of the filing company$"), "Permissive statement: allows a value, imposes no validation constraint"),
]
# Enumerated values quoted in the rule text that differ in wording from the taxonomy enumeration.
ENUM_ALIASES = {"key managerial personnel": "Key Management Personnel"}

_CURLY_D = js("[“”]")
_CURLY_S = js("[‘’]")


def _gt0(q: str) -> dict:
    return cmp(">", nd(q), const(0))


def _ne0(q: str) -> dict:
    return cmp("!=", nd(q), const(0))


def _upper_eq(v: str, e: dict = SELF) -> dict:
    return cmp("==", {"upper": e}, const(v))


# ------------------------------------------------------------------------------------------------- specific
def formalize_specific(clause: str, subject: str, row: SpecificRow, cx: Context) -> dict:
    A, R = cx.A, cx.R
    s = trim(collapse_ws(_CURLY_S.sub("'", _CURLY_D.sub('"', clause))))
    # "If value of 'DesignationOfKeyManagerialPersonnelOrDirector' is one of the below then Name should be based on
    # DIN …: (Managing Director) (Whole Time Director) …". Matching the name to the DIN register needs MCA21 master
    # data, but the DIN itself must be present (the MCA XBRL Validator reports "Element 'DirectorIdentificationNumber…'
    # is required, since value of DesignationOf… is equal to [Independent Director]"). That part is executed here.
    if ji(r"^If value of .DesignationOfKeyManagerialPersonnelOrDirector. is one of the below then Name should be based on DIN").search(s):
        des = R.concept("DesignationOfKeyManagerialPersonnelOrDirector")
        din = R.concept("DirectorIdentificationNumberOfKeyManagerialPersonnelOrDirector")
        head = ji(r"based on PAN").split(s)[0]
        named = [trim(x.group(1)) for x in js(r"\(([^)]+)\)").finditer(head)]
        if named:
            return {
                "status": "EXECUTABLE", "implementation": "curated:kmp-din-required", "scope": {"periods": ["CY", "PY"]},
                "ast": {
                    "type": "eachFactOf", "concept": des,
                    "when": {"op": "or", "args": [cmp("==", {"upper": SELF}, const(v.upper())) for v in named]},
                    "assert": entered({"fact": din}),
                    "message": f"'DirectorIdentificationNumberOfKeyManagerialPersonnelOrDirector' is required for a designation of {', '.join(named)} (the name is checked by MCA against the DIN)",
                },
            }
    for rx, reason in EXTERNAL:
        if rx.search(s):
            return {"status": "REVIEW_ONLY_EXTERNAL_DATA", "reason": reason, "implementation": "review:external-data"}
    for rx, reason in NO_CONSTRAINT:
        if rx.search(s):
            return {"status": "NOT_APPLICABLE", "reason": reason}

    def ok(impl: str, ast: dict, scope: dict | None = None) -> dict:
        return executable(impl, ast, scope)

    is_table_row = A["concepts"][subject]["kind"] == "hypercube"

    # -------- table-level rules
    if is_table_row:
        tables = R.tables_by_hc(R.local(subject))

        def tr(when: Any, impl: str) -> dict:
            return ok(f"pattern:{impl}", {"type": "tableRequired", "tables": tables, "when": when}, {"periods": ["CY", "PY"]})

        m = ji(rf"mandatory in case (?:value entered in |amount entered in )?{Q} is greater than zero").search(s)
        if m and not ji(r" or ").search(s):
            q = R.concept(m.group(1))
            if q:
                return tr(_gt0(q), "table-if-gt0")
        m = ji(rf"mandatory in case (?:amount entered in )?{Q} or {Q} is (greater than|other than) zero").search(s) or ji(
            rf"mandatory in case either {Q} or {Q} is (greater than|other than) zero"
        ).search(s)
        if m:
            a, b = R.concept(m.group(1)), R.concept(m.group(2))
            f = _gt0 if ji("greater").search(m.group(3)) else _ne0
            if a and b:
                return tr({"op": "or", "args": [f(a), f(b)]}, "table-if-any")
        m = ji(rf"mandatory (?:in case|if) {Q} is other than zero").search(s) or ji(r"mandatory if (\w+) in balance sheet is other than zero").search(s)
        if m:
            q = R.concept(m.group(1))
            if q:
                return tr(_ne0(q), "table-if-ne0")
        m = ji(rf"mandatory in case {Q} is selected in field {Q}").search(s)
        if m:
            q = R.concept(m.group(2))
            if q and ji(r"^yes$").search(m.group(1)):
                return tr(cmp("==", nd(q), const(True)), "table-if-yes")
        if js(r"details are entered for 'BondsMember or DebenturesMember' under 'Classification of borrowings \[Axis\]' and vice-a-versa").search(s):
            bt = R.tables_by_hc("ClassificationOfBorrowingsTable")
            members = [R.concept("BondsMember"), R.concept("DebenturesMember")]
            axis = R.concept("ClassificationOfBorrowingsAxis")
            return ok("curated:bonds-debentures-iff", {"type": "tableIffMembers", "tables": tables, "otherTables": bt, "axis": axis, "members": members}, {"periods": ["CY", "PY"]})
        x = _formalize_extended(s, subject, row, cx, ok)
        if x:
            return x
        return {"status": "UNIMPLEMENTED", "reason": "Unrecognised table-level rule form"}

    # -------- external-data dependent (company master data / status)
    if ji(r"company not having share capital|company having share capital|Status of the company \(Pvt/Public/Section 8\)").search(s):
        return {"status": "REVIEW_ONLY_EXTERNAL_DATA", "reason": "Requires company class / share-capital status from MCA21 company master data, which is not part of the instance document", "implementation": "review:external-master-data"}

    # -------- mandatory (unconditional)
    if ji(r"^(This is a mandatory field|It is a mandatory field|This item is mandatory|This item will be Mandatory|This is a Mandatory field)$").search(s):
        return ok("pattern:mandatory", {"type": "mandatory", "concept": subject})
    # -------- sign rules
    if ji(r"^Should be greater than (or )?(equal|eqaul)( to)? zero$").search(s) or ji(r"^Should be greater than equal to zero$").search(s):
        return ok("pattern:gte0", {"type": "eachFact", "concept": subject, "assert": cmp(">=", SELF, const(0))})
    if ji(r"^Should be greater than zero$").search(s):
        return ok("pattern:gt0", {"type": "eachFact", "concept": subject, "assert": cmp(">", SELF, const(0))})
    if ji(r"^Should be less than or equal to 100%$").search(s):
        # percentItemType values are decimal fractions (Filing Manual Annex II #5: 60% is entered as 0.6)
        return ok("pattern:lte100pct", {"type": "eachFact", "concept": subject, "assert": cmp("<=", SELF, const(1))})
    if ji(r"^Should be less than or equal to system date$").search(s):
        return ok("pattern:lte-today", {"type": "eachFact", "concept": subject, "assert": cmp("<=", SELF, {"today": True})})
    # -------- comparisons with another element (same context)
    m = ji(rf"^Should be less than or equal to {Q}$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            return ok("pattern:lte-ref", {"type": "eachFact", "concept": subject, "assert": cmp("<=", SELF, {"fact": q})})
        if ji(r"Value of shares subscribed - equity \+ Preference").search(m.group(1)):
            axis = R.concept("ClassesOfShareCapitalAxis")
            return ok("curated:sharecapital-lte-subscribed", {"type": "assert", "assert": cmp("<=", nd(subject), {"sumAxis": {"concept": R.concept("ValueOfSharesSubscribed"), "axis": axis, "level": "firstLevel"}})})
    m = ji(rf"^Should be equal to {Q} multiplied by {Q}$").search(s)
    if m:
        a, b = R.concept(m.group(1)), R.concept(m.group(2))
        if a and b:
            return ok("pattern:eq-product", {"type": "eachFact", "concept": subject, "assert": cmp("==", SELF, {"mul": [{"fact": a}, {"fact": b}]})})
    m = ji(rf"^Should be equal to value entered in element {Q} in Balance sheet$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            return ok("pattern:eq-ref", {"type": "eachFact", "concept": subject, "assert": cmp("==", SELF, {"fact": q})})

    # -------- conditional mandatory
    def mand(when: Any, impl: str) -> dict:
        return ok(f"pattern:{impl}", {"type": "mandatory", "concept": subject, "when": when})

    if ji(r"^Mandatory in case of Consolidated financial statement instance document$").search(s):
        return mand({"op": "reportType", "value": "Consolidated"}, "mandatory-consolidated")
    if ji(r"^This shall be a mandatory field in case of standalone instance document$").search(s):
        return mand({"op": "reportType", "value": "Standalone"}, "mandatory-standalone")
    m = (
        ji(rf"^Mandatory,? if {Q} is yes$").search(s)
        or ji(r"^Mandatory,? if (\w+) is Yes$").search(s)
        or ji(rf"^Mandatory in case Yes is selected in element {Q}$").search(s)
    )
    if m:
        q = R.concept(m.group(1))
        if q:
            return mand(cmp("==", nd(q), const(True)), "mandatory-if-yes")
    m = ji(rf"^Mandatory in case value is entered in field {Q}$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            return ok("pattern:mandatory-if-entered", {"type": "eachFactOf", "concept": q, "assert": entered({"fact": subject})})
    m = ji(rf"^Mandatory if {Q} is entered and vice a versa$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            return ok("pattern:mandatory-iff-entered", {"type": "iffEntered", "concepts": [subject, q]})
    if ji(r"^Mandatory if corresponding Number of shares is entered and vice-a-versa$").search(s):
        pair = AMOUNT_NUMBER_PAIRS.get(R.local(subject))
        q = pair and R.concept(pair)
        if q:
            return ok("curated:amount-number-pair", {"type": "iffEntered", "concepts": [subject, q]})
        return {"status": "UNIMPLEMENTED", "reason": "No corresponding number-of-shares element identified"}
    if ji(r"^Mandatory in case Beginning Date of continuing Default is entered$").search(s):
        q = R.concept("BeginningDateOfContinuingDefaultForBorrowings")
        return ok("curated:continuing-default", {"type": "eachFactOf", "concept": q, "assert": entered({"fact": subject})})
    m = ji(rf"^Mandatory in case of {Q}$").search(s)
    if m:
        mem = R.concept(m.group(1))
        if mem and A["concepts"][mem]["kind"] == "member":
            return ok("pattern:mandatory-for-member", {"type": "memberMandatory", "concept": subject, "member": mem})
    m = ji(rf"^This shall be mandatory in case details in respect of {Q} is entered$").search(s)
    if m:
        mem = R.concept(m.group(1))
        if mem and A["concepts"][mem]["kind"] == "member":
            return ok("pattern:mandatory-for-member", {"type": "memberMandatory", "concept": subject, "member": mem})

    m = ji(
        rf"^(?:Mandatory,? if|This is mandatory in case) (?:value (?:entered )?in (?:field )?)?{Q}(?: in (?:balance sheet|financial statements?))? is greater than zero$"
    ).search(s) or ji(r"^Mandatory if (\w+) is greater than zero$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            if is_nondim_only(q, A) or ji(r"in (balance sheet|financial statements?)").search(s):
                return mand(_gt0(q), "mandatory-if-gt0")
            return ok("pattern:mandatory-if-gt0", {"type": "eachFactOf", "concept": q, "when": cmp(">", SELF, const(0)), "assert": entered({"fact": subject})})
    m = ji(rf"^Mandatory in case {Q} is other than zero$").search(s) or ji(r"^This is mandatory in case Value in (\w+) is other than Zero$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            if is_nondim_only(q, A):
                return mand(_ne0(q), "mandatory-if-ne0")
            return ok("pattern:mandatory-if-ne0", {"type": "eachFactOf", "concept": q, "when": cmp("!=", SELF, const(0)), "assert": entered({"fact": subject})})
    # -------- formats
    if ji(r"^Valid CIN$").search(s):
        return ok("pattern:format-cin", {"type": "eachFact", "concept": subject, "assert": {"op": "format", "format": "CIN", "e": SELF}})
    if ji(r"^Should be valid PAN as per Income_tax_PAN format$").search(s):
        return ok("pattern:format-pan", {"type": "eachFact", "concept": subject, "assert": {"op": "format", "format": "PAN", "e": SELF}})
    if ji(r"^Should be valid country name as per List of countries$").search(s):
        return ok("pattern:format-country", {"type": "eachFact", "concept": subject, "assert": {"op": "format", "format": "country", "e": SELF}})

    # -------- curated summation / cross-table rules
    ax = R.concept

    def sum_eq(impl: str, target: str | None, sum_spec: dict) -> dict:
        return ok(f"curated:{impl}", {"type": "assert", "assert": cmp("==", {"sumAxis": sum_spec}, nd(target))})

    class_pattern = {"axis": ax("ClassesOfShareCapitalAxis"), "pattern": r"^(Equity|Preference)Shares\d+Member$"}
    if (ji(r"^Summation of 'Value of Shares paid up' for\s+'EquitySharesMembers 1\.\.10'").search(s) or ji(r"^Summation of 'ShareCapital' \(Closing\)'").search(s)) and R.concept("ShareCapital") and class_pattern["axis"]:
        return sum_eq("sharecapital-classes-sum", R.concept("ShareCapital"), {"concept": subject, **class_pattern, "level": "pattern"})
    if ji(r"^Total Value of Reserves- \(Closing Balance\) should be equal to value entered in 'ReservesAndSurplus'").search(s):
        return sum_eq("reserves-first-level", R.concept("ReservesAndSurplus"), {"concept": subject, "axis": ax("ComponentsOfReservesAxis"), "level": "firstLevel"})
    m = ji(r"^Summation of various Borrowings members\s+for (Long|Short) term period should be equal to '(\w+)'").search(s)
    if m:
        return sum_eq("borrowings-first-level", R.concept(m.group(2)), {
            "concept": subject, "axis": ax("ClassificationOfBorrowingsAxis"), "level": "firstLevel",
            "fixed": {_key(ax("ClassificationBasedOnTimePeriodAxis")): R.concept(f"{m.group(1)}TermMember")},
        })
    m = ji(r"^Summation of '(\w+)' for all dimensional members should be equal to '(\w+)' in (Financial statements|Balance sheet)$").search(s)
    if m:
        typed_axis = next((a for t in A["tables"] if subject in t["lineItems"] for a in t["axes"] if a["typed"]), None)
        if typed_axis:
            return sum_eq("typed-members-sum", R.concept(m.group(2)), {"concept": subject, "axis": typed_axis["axis"], "level": "all"})
    m = ji(r"^Summation of '(\w+)' and '(\w+)' should be equal to '(\w+)' in (financial statements|Balance Sheet)$").search(s)
    if m:
        a, b, c = R.concept(m.group(1)), R.concept(m.group(2)), R.concept(m.group(3))
        if a and b and c:
            return ok("pattern:sum-two-eq", {"type": "assert", "assert": cmp("==", {"add": [nd(a), nd(b)]}, nd(c))})
    m = ji(r"^Summation of all (Provisions|LoansAndAdvances) - Long term member and Short term member should be equal to '(\w+)' and '(\w+)' respectively").search(s)
    if m:
        time = ax("ClassificationBasedOnTimePeriodAxis")
        first_level_axis = ax("ClassificationOfLoansAndAdvancesAxis") if m.group(1) == "LoansAndAdvances" else None

        def spec(term: str) -> dict:
            if first_level_axis:
                return {"concept": subject, "axis": first_level_axis, "level": "firstLevel", "fixed": {_key(time): R.concept(f"{term}TermMember")}}
            return {"concept": subject, "axis": time, "level": "members", "members": [R.concept(f"{term}TermMember")]}

        return ok(f"curated:{m.group(1).lower()}-term-sum", {"type": "assert", "assert": {"op": "and", "args": [
            cmp("==", {"sumAxis": spec("Long")}, nd(R.concept(m.group(2)))),
            cmp("==", {"sumAxis": spec("Short")}, nd(R.concept(m.group(3)))),
        ]}})
    if ji(r"^Either CIN of shareholder or PAN of shareholder is Mandatory in case Country of incorporation or residence of shareholder is India$").search(s):
        return ok("curated:shareholder-cin-or-pan", {
            "type": "eachFactOf", "concept": R.concept("CountryOfIncorporationOrResidenceOfShareholder"),
            "when": _upper_eq("INDIA"),
            "assert": {"op": "or", "args": [entered({"fact": R.concept("CINOfShareholder")}), entered({"fact": R.concept("PANOfShareholder")})]},
        })
    if ji(r"^Summation of all shareholder members should be less than or equal to summation of\s+'Number of Shares Paid Up'").search(s):
        return ok("curated:shareholders-lte-paidup", {"type": "assert", "assert": cmp(
            "<=",
            {"sumAxis": {"concept": subject, "axis": ax("NameOfShareholderAxis"), "level": "all", "anyOther": True}},
            {"sumAxis": {"concept": R.concept("NumberOfSharesPaidUp"), **class_pattern, "level": "pattern"}},
        )})
    m = ji(r"^Summation of all shareholder for (equity|preference) members should be less than or equal to 100%$").search(s)
    if m:
        under = R.concept("EquitySharesMember" if m.group(1) == "equity" else "PreferenceSharesMember")
        # per class of share: sum over shareholders within each class member under the equity/preference node <= 100%
        return ok("curated:shareholding-pct-lte-100", {"type": "groupSum", "concept": subject, "groupAxis": ax("ClassesOfShareCapitalAxis"), "groupUnder": under, "sumAxis": ax("NameOfShareholderAxis"), "cmp": "<=", "limit": 1})
    if ji(r"^Either this element or NumberOfPersonsOnPrivatePlacementOfPreferenceShare is mandatory if 'NumberOfSharesIssuedInPrivatePlacement' is greater than zero$").search(s):
        # 'NumberOfSharesIssuedInPrivatePlacement' is not a 2016 element; the 2016 private-placement share counts are
        # NumberOfSharesIssuedInPrivatePlacementArisingOutOfConversion... and NumberOfSharesIssuedInOtherPrivatePlacement.
        counts = [R.concept(n) for n in ["NumberOfSharesIssuedInPrivatePlacementArisingOutOfConversionOfDebenturesPreferenceSharesDuringPeriod", "NumberOfSharesIssuedInOtherPrivatePlacement"]]
        return ok("curated:private-placement-persons", {
            "type": "assert",
            "when": {"op": "or", "args": [{"op": "anyFact", "concept": c, "pred": cmp(">", SELF, const(0))} for c in counts]},
            "assert": {"op": "or", "args": [entered(nd(subject)), entered(nd(R.concept("NumberOfPersonsOnPrivatePlacementOfPreferenceShare")))]},
        })
    m = ji(r"^Mandatory if (NumberOfPersonsOnPrivatePlacementOf\w+) is greater than zero$").search(s)
    if m:
        q = R.concept(m.group(1))
        if q:
            return mand(_gt0(q), "mandatory-if-gt0")
    if ji(r"^YES should be selected in case amount entered in 'AmountOfPublicIssueDuringPeriod' is greater than zero$").search(s):
        return ok("curated:public-offering-yes", {
            "type": "assert",
            "when": {"op": "anyFact", "concept": R.concept("AmountOfPublicIssueDuringPeriod"), "pred": cmp(">", SELF, const(0))},
            "assert": cmp("==", nd(subject), const(True)),
        }, {"periods": ["CY"]})
    x = _formalize_extended(s, subject, row, cx, ok)
    if x:
        return x
    return {"status": "UNIMPLEMENTED", "reason": "No pattern or curated formalization matched this clause"}


def _key(q: str | None) -> str:
    """A JS computed key: ``{[null]: …}`` is ``"null"``."""
    return "null" if q is None else q


# ------------------------------------------------------------------------------------------------- conditions
@dataclass
class Condition:
    concepts: list[str]
    pred: Callable[[Callable[[str], dict]], dict]
    nondim: bool = False


def parse_condition(c: str, cx: Context) -> Condition | None:
    """Condition grammar of conditional-mandatory sentences. ``pred(ref)`` builds the predicate, where ``ref(q)``
    yields the operand expression for concept ``q``."""
    A, R = cx.A, cx.R

    def enum_of(q: str) -> list[str] | None:
        t = (A.get("types") or {}).get((A["concepts"].get(q) or {}).get("type"))
        return (t or {}).get("enumerations") or None

    def yes(q: str, v: bool) -> Condition:
        return Condition([q], lambda ref: cmp("==", ref(q), const(v)))

    def is_bool(q: str | None) -> bool:
        return bool(q) and A["concepts"][q]["type"] == "xbrli:booleanItemType"

    m = ji(rf"^'?(Yes|No)'? (?:is )?selected in (?:field |element )?(?:{QQ}|(\w+))$").search(c)
    if m:
        q = R.concept(m.group(2) or m.group(3))
        if is_bool(q):
            return yes(q, bool(ji(r"^yes$").search(m.group(1))))
    m = ji(rf"^(?:{QQ}|(\w+)) is (?:selected as )?'?(Yes|No)'?$").search(c)
    if m:
        q = R.concept(m.group(1) or m.group(2))
        if is_bool(q):
            return yes(q, bool(ji(r"^yes$").search(m.group(3))))
    m = ji(rf"^(?:{QQ}|(\w+)) is entered$").search(c)
    if m:
        q = R.concept(m.group(1) or m.group(2))
        if q:
            return Condition([q], lambda ref, q=q: entered(ref(q)))
    if ji(r"^name of the service provider? (?:is )?entered$").search(c):
        q = R.concept("NameOfTheServiceProvider")
        if q:
            return Condition([q], lambda ref, q=q: entered(ref(q)))
    if ji(r"""^Yes is selected in "where the books of account and other books and papers are maintained on cloud-?"?$""").search(c):
        q = R.concept("WhetherBooksOfAccountAndOtherBooksAndPapersAreMaintainedOnCloud")
        if q:
            return yes(q, True)

    def num(op: str, q: str) -> Condition:
        return Condition([q], lambda ref: cmp(op, ref(q), const(0)), nondim=True)

    m = ji(rf"^(?:value entered in |amount of |amount entered in )?(?:{QQ}|(\w+))(?: in (?:balance sheet|financial statements?))? is greater than zero$").search(c)
    if m:
        q = R.concept(m.group(1) or m.group(2))
        if q and A["concepts"][q]["kind"] == "item":
            return num(">", q)
    m = ji(rf"^(?:{QQ}|(\w+))(?: in (?:balance sheet|financial statements?))? is other than zero(?: in (?:balance sheet|financial statements?))?$").search(c)
    if m:
        q = R.concept(m.group(1) or m.group(2))
        if q and A["concepts"][q]["kind"] == "item":
            return num("!=", q)
    m = ji(rf"^{QQ}\s*or\s*{QQ} is greater than zero$").search(c)
    if m:
        a, b = R.concept(m.group(1)), R.concept(m.group(2))
        if a and b:
            return Condition([a, b], lambda ref: {"op": "or", "args": [cmp(">", ref(q), const(0)) for q in (a, b)]}, nondim=True)
    m = ji(rf"^{QQ} is selected in {QQ}$").search(c)
    if m:
        q = R.concept(m.group(2))
        en = q and enum_of(q)
        v = en and (next((e for e in en if e.lower() == m.group(1).lower()), None) or ENUM_ALIASES.get(m.group(1).lower()))
        if v and v in en:
            return Condition([q], lambda ref: cmp("==", {"upper": ref(q)}, const(v.upper())))
    m = ji(r'^(\w+) is other than "([^"]+)"$').search(c)
    if m:
        q = R.concept(m.group(1))
        en = q and enum_of(q)
        v = en and next((e for e in en if e.lower() == m.group(2).lower()), None)
        if v:
            return Condition([q], lambda ref: cmp("!=", {"upper": ref(q)}, const(v.upper())))
    m = ji(r'^"?DateOfStartOfReportingPeriod"? is more than (\d{2})/(\d{2})/(\d{4})$').search(c)
    if m:
        q = R.concept("DateOfStartOfReportingPeriod")
        date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        return Condition([q], lambda ref: cmp(">", ref(q), {"const": date, "kind": "date"}), nondim=True)
    return None


def tables_of_row(subject: str, row: SpecificRow, A: dict) -> list[str]:
    alls = [t for t in A["tables"] if subject in t["lineItems"]]
    here = [t for t in alls if t["code"] == row.elr.code or t["id"].startswith(row.elr.code)] if row.elr else []
    return [t["id"] for t in (here or alls)]


# ------------------------------------------------------------------------------------------------- extended
def _formalize_extended(s: str, subject: str, row: SpecificRow, cx: Context, ok) -> dict | None:
    A, R = cx.A, cx.R
    is_table = A["concepts"][subject]["kind"] == "hypercube"

    def nondim(q: str) -> bool:
        return is_nondim_only(q, A)

    def each(impl: str, assert_: dict, extra: dict | None = None, scope: dict | None = None) -> dict:
        return ok(f"pattern:{impl}", {"type": "eachFact", "concept": subject, "assert": assert_, **(extra or {})}, scope)

    def ref_of(q: str) -> dict:
        return nd(q) if nondim(q) else {"fact": q}

    # -------- table-level
    if is_table:
        tables = R.tables_by_hc(R.local(subject))
        if not tables:
            return None
        if ji(r"^(?:This (?:is a|ia a) mandatory table|This table is mandatory)$").search(s):
            return ok("pattern:table-mandatory", {"type": "tableRequired", "tables": tables, "when": None}, {"periods": ["CY", "PY"]})
        m = ji(rf"^{MAND_HEAD}(?: only)?,? (?:if|in case) (.+)$").search(s)
        if m:
            c = parse_condition(trim(m.group(1)), cx)
            # "mandatory if" is a requirement, not an availability restriction: the MCA-validated FILING-B instance
            # reports [201100] intangible-asset rows while IntangibleAssets = 0. Only "mandatory only if" also
            # restricts the table to the condition (gate).
            gate = bool(ji(r"\bonly if\b").search(s))
            if c and (c.nondim or all(nondim(q) for q in c.concepts)):
                return ok("pattern:table-conditional", {"type": "tableRequired", "tables": tables, "when": c.pred(nd), "gate": gate}, {"periods": ["CY", "PY"]})
            if c:
                return ok("pattern:table-conditional", {"type": "tableRequired", "tables": tables, "when": {"op": "anyFact", "concept": c.concepts[0], "pred": c.pred(lambda _q: SELF)}, "gate": gate}, {"periods": ["CY", "PY"]})
        if ji(r"^All Details(?: \(Except name of audit firm\))? of atleast one (?:director|auditor) (?:should be entered|to be mandatory)$").search(s):
            except_ = [R.concept("NameOfAuditFirm")] if ji(r"Except name of audit firm").search(s) else []
            return ok("pattern:table-one-complete-member", {"type": "tableOneComplete", "tables": tables, "except": except_}, {"periods": ["CY"]})
        return None

    # -------- line-items abstract
    if js(r"LineItems$").search(R.local(subject)) and ji(r"^In case a line item is provided for any member then the same line item cannot be provided against any other member$").search(s):
        tables = R.tables_by_hc(js(r"LineItems$").sub("Table", R.local(subject), count=1))
        if tables:
            return ok("pattern:line-item-single-member", {"type": "lineItemSingleMember", "tables": tables}, {"periods": ["CY", "PY"]})
    if A["concepts"][subject].get("abstract") and ji(r"^Mandatory if").search(s):
        return {"status": "NOT_APPLICABLE", "reason": "Abstract element: cannot carry a value; the same condition is executed on each of its line items (following rows)"}

    # -------- unconditional mandatory
    if ji(r"^(?:This is mandatory field|This field is mandatory|This is a mandatory item|This is a mandatory element)$").search(s):
        return ok("pattern:mandatory", {"type": "mandatory", "concept": subject})
    if ji(r"^Mandatory Line item$").search(s):
        return ok("pattern:mandatory-line-item", {"type": "lineItemsMandatory", "tables": tables_of_row(subject, row, A), "concepts": [subject]})
    # -------- report type / current year
    standalone = {"op": "reportType", "value": "Standalone"}
    if ji(r"^This is a mandatory field (?:only )?(?:in case of |for )?stand ?alone (?:instance|intance) document(?: only)?$").search(s) or ji(
        r"^This is a mandatory field in case of standalone instance document(?: only)?$"
    ).search(s):
        return ok("pattern:mandatory-standalone", {"type": "mandatory", "concept": subject, "when": dict(standalone)})
    if ji(r"^This is a mandatory field only in case of stand alone intance document$").search(s):
        return ok("pattern:mandatory-standalone", {"type": "mandatory", "concept": subject, "when": dict(standalone)})
    if ji(r"^This is mandatory (?:field )?in case of current financial year$").search(s):
        return ok("pattern:mandatory-current-year", {"type": "mandatory", "concept": subject}, {"periods": ["CY"]})
    if ji(r"^This is mandatory field in case of current financial year and stand alone instance document only$").search(s):
        return ok("pattern:mandatory-current-year-standalone", {"type": "mandatory", "concept": subject, "when": dict(standalone)}, {"periods": ["CY"]})

    # -------- sign / range
    if ji(r"^(?:Should|Shall|It should) be (?:greater than or equal to|equal to or greater than) zero(?: \(if entered\))?$").search(s):
        return each("gte0", cmp(">=", SELF, const(0)))
    if ji(r"^This should be greater than zero$").search(s):
        return each("gt0", cmp(">", SELF, const(0)))
    if ji(r"^Should not be greater than 100%$").search(s):
        return each("lte100pct", cmp("<=", SELF, const(1)))
    if ji(r"^Should be less than system date$").search(s):
        return each("lt-today", cmp("<", SELF, {"today": True}))
    if ji(r"^Difference between this date and system date should be greater than or equal to 18 years$").search(s):
        return each("min-age-18", cmp("<=", SELF, {"addMonths": {"e": {"today": True}, "n": -216}}))

    # -------- formats
    if ji(r"^(?:Should|It should) be (?:a )?valid PAN as per (?:the )?income[ _]tax(?:[ _]PAN)? format$").search(s) or ji(r"^Should be a valid PAN as per the income tax format$").search(s):
        return each("format-pan", {"op": "format", "format": "PAN", "e": SELF})
    if ji(r"^Should be (?:a )?valid CIN(?:, if provided)?$").search(s):
        return each("format-cin", {"op": "format", "format": "CIN", "e": SELF})
    if ji(r"^Should be a valid country as per the list of countries$").search(s):
        return each("format-country", {"op": "format", "format": "country", "e": SELF})
    if ji(r"^Should be INR$").search(s):
        return each("eq-const", cmp("==", {"upper": SELF}, const("INR")))
    if ji(r"^Only Commercial and Industrial can be selected for the time being$").search(s):
        return each("eq-const", cmp("==", SELF, const("Commercial and Industrial")), {}, {"periods": ["CY"]})

    # -------- different from the filing company / auditor
    cin, pan = R.concept("CorporateIdentityNumber"), R.concept("PermanentAccountNumberOfEntity")

    def cy(q: str | None) -> dict:
        return {"fact": q, "ctx": "nondim", "scope": "CY"}

    if ji(r"^Should be different from CIN of filing company(?: \(CorporateIdentityNumber\))?$").search(s):
        return each("ne-filing-cin", cmp("!=", {"upper": SELF}, {"upper": cy(cin)}))
    if ji(r"^Should be different from (?:the )?PAN of (?:the )?(?:filing )?company$").search(s):
        return each("ne-filing-pan", cmp("!=", {"upper": SELF}, {"upper": cy(pan)}))
    if ji(r"^Should be different from the PAN of company and auditor$").search(s):
        return each("ne-filing-pan-auditor", {"op": "and", "args": [
            cmp("!=", {"upper": SELF}, {"upper": cy(pan)}),
            {"op": "notInFacts", "e": SELF, "concept": R.concept("PermanentAccountNumberOfAuditorOrAuditorsFirm")},
        ]})
    # -------- uniqueness across the members of a repetitive (typed) table
    if ji(r"should be unique").search(s) and ji(r"repetitive|dimension|tuple").search(s):
        return ok("pattern:unique-across-members", {"type": "unique", "concept": subject, "tables": tables_of_row(subject, row, A)})

    # -------- comparisons with another element
    m = ji(rf"^Should be greater than or equal to (?:{QQ}|(\w+))(?: entered)?$").search(s)
    if m:
        q = R.concept(m.group(1) or m.group(2))
        if q:
            return each("gte-ref", cmp(">=", SELF, ref_of(q)))
    m = js(r"^Should be greater than or equal to (\d{2})\.(\d{2})\.(\d{4})$").search(s)
    if m:
        return each("gte-date", cmp(">=", SELF, {"const": f"{m.group(3)}-{m.group(2)}-{m.group(1)}", "kind": "date"}))
    if ji(r"^Should be greater than or equal to Date of signing balance sheet by director or secretary or manager\. In case of multiple dates, latest date should be considered$").search(s):
        qs = [R.concept(n) for n in ["DateOfSigningOfFinancialStatementsByDirector", "DateOfSigningOfFinancialStatementsByCompanySecretary", "DateOfSigningOfFinancialStatementsByManager"]]
        return each("gte-latest-of", cmp(">=", SELF, {"maxFacts": qs}))
    if ji(r"^Difference between start date and end date should not be greater than 18 months$").search(s):
        return each("max-18-months", cmp("<", SELF, {"addMonths": {"e": nd(R.concept("DateOfStartOfReportingPeriod")), "n": 18}}))
    if ji(r"^In case of previous year, date entered in this field should be one day less than date entered in field 'DateOfStartOfReportingPeriod' for current year\.?'?$").search(s):
        return each("py-end-before-cy-start", cmp("==", SELF, {"addDays": {"e": cy(R.concept("DateOfStartOfReportingPeriod")), "n": -1}}), {}, {"periods": ["PY"]})
    m = ji(r"^Value in CarryingAmountMember should be equal to '(\w+)' less '(\w+)'$").search(s)
    if m:
        gross, acc, carrying = R.concept(m.group(1)), R.concept(m.group(2)), R.concept("CarryingAmountMember")
        axis = next((a for t in A["tables"] if subject in t["lineItems"] for a in t["axes"]
                     if all(any(y["member"] == x for y in a.get("members") or []) for x in (gross, acc, carrying))), None)
        if axis:
            return ok("pattern:member-difference", {"type": "memberArith", "concept": subject, "axis": axis["axis"], "target": carrying, "plus": [gross], "minus": [acc]})
    m = ji(r"^Summation of CarryingAmountMember for the following (?:first level child )?members in ClassesOf ?(Tangible|Intangible)AssetsAxis should be equal to '(\w+)' in Balance sheet: (.+)$").search(s)
    if m:
        axis = R.concept(f"ClassesOf{m.group(1)}AssetsAxis")
        listed = js(r"\s+").split(trim(m.group(3)))
        members = [R.concept(n) or R.concept(js(r"Member$").sub("sMember", n, count=1)) for n in listed]
        if axis and all(members):
            return ok("pattern:listed-members-sum", {"type": "assert", "assert": cmp("==", {"sumAxis": {"concept": subject, "axis": axis, "level": "members", "members": members}}, nd(R.concept(m.group(2))))})
    m = ji(r"^Summation of (\w+) - (\w+); (\w+); (\w+) should be equal to '(\w+)' in financial statements$").search(s)
    if m:
        members = [R.concept(n) for n in (m.group(2), m.group(3), m.group(4))]
        axis = next((a for t in A["tables"] if subject in t["lineItems"] for a in t["axes"]
                     if all(any(y["member"] == x for y in a.get("members") or []) for x in members)), None)
        if axis and R.concept(m.group(1)) == subject:
            return ok("pattern:listed-members-sum", {"type": "assert", "assert": cmp("==", {"sumAxis": {"concept": subject, "axis": axis["axis"], "level": "members", "members": members}}, nd(R.concept(m.group(5))))})

    # -------- CSR ([301000] / [301000a])
    if ji(r'^Value entered in this field Financial Year Member 1, should match with the value entered in the ELR "100200" for the element "ProfitBeforeTax" for the previous reporting period$').search(s):
        return each("fy1-eq-py-pbt", cmp("==", SELF, {"fact": R.concept("ProfitBeforeTax"), "ctx": "nondim", "scope": "PY"}), {"when": {"op": "hasMember", "member": R.concept("FinancialYearMember1")}}, {"periods": ["CY"]})
    if ji(r"^Details of atleast year one member will be mandatory if Disclosure of net profits for last three financial years \[Table\] becomes mandatory$").search(s):
        tables = R.tables_by_hc("DisclosureOfNetProfitsForLastThreeFinancialYearsTable")
        csr = R.concept("WhetherProvisionsOfCorporateSocialResponsibilityAreApplicableOnCompany")
        return ok("curated:csr-fy1-member", {"type": "assert", "when": cmp("==", nd(csr), const(True)), "assert": {"op": "memberHasData", "tables": tables, "member": R.concept("FinancialYearMember1")}}, {"periods": ["CY"]})
    m = ji(r'^Value entered here should be equivalent to average of values entered in "(\w+)"$').search(s)
    if m:
        q = R.concept(m.group(1))
        first = next((t for t in A["tables"] if q in t["lineItems"]), None) if q else None
        axis = first["axes"][0] if first else None
        if axis:
            return each("eq-average-of-members", cmp("==", SELF, {"avgAxis": {"concept": q, "axis": axis["axis"], "level": "all"}}, approx=True), {}, {"periods": ["CY"]})
    if ji(r'^Value entered here should be 2 percent of "AverageNetProfitForLastThreeFinancialYears" if "AverageNetProfitForLastThreeFinancialYears" is greater than zero$').search(s):
        avg = R.concept("AverageNetProfitForLastThreeFinancialYears")
        return each("eq-2pct-average", cmp("==", SELF, {"mul": [nd(avg), {"const": "0.02"}]}, approx=True), {"when": cmp(">", nd(avg), const(0))}, {"periods": ["CY"]})
    if ji(r"""^(?:The amount entered here should be same as "CSRExpenditure" in ELR 100200 of 'Statement of profit and loss"\s*)+$""").search(s):
        return each("eq-ref", cmp("==", SELF, nd(R.concept("CSRExpenditure"))), {}, {"periods": ["CY"]})
    if ji(r"^AND It should match with the total of CSR spending amount in the 'ClassificationOfCSRSpendingTable' table element 'AmountSpentOnProjectsOrPrograms'$").search(s):
        q = R.concept("AmountSpentOnProjectsOrPrograms")
        axis = next(t for t in A["tables"] if q in t["lineItems"])["axes"][0]
        return each("eq-table-total", cmp("==", SELF, {"sumAxis": {"concept": q, "axis": axis["axis"], "level": "all"}}), {}, {"periods": ["CY"]})

    # -------- related parties / group entities
    if ji(r"^\(Holding company\) or \(Ultimate Holding company\) should be selected in atleast one dimensional member in case Yes is selected in 'WhetherCompanyIsSubsidiaryCompany' and vice-a-versa$").search(s):
        sub = R.concept("WhetherCompanyIsSubsidiaryCompany")
        holding = {"op": "existsFact", "concept": subject, "pred": {"op": "or", "args": [_upper_eq(v) for v in ("HOLDING COMPANY", "ULTIMATE HOLDING COMPANY")]}}
        return ok("curated:holding-iff-subsidiary", {"type": "assert", "when": entered(cy(sub)), "assert": {"op": "iff", "args": [cmp("==", cy(sub), const(True)), holding]}})

    def same_table(pred: Callable[[str], bool]) -> str | None:
        return next((q for t in A["tables"] if subject in t["lineItems"] for q in t["lineItems"] if pred(q)), None)

    if ji(r"^Either .+ is mandatory if country is India$").search(s) or ji(r"^Mandatory if country is India$").search(s):
        country = same_table(lambda q: bool(js(r"^CountryOfIncorporationOrResidence").search(R.local(q))))
        loc = R.local(subject)

        def swaps(n: str) -> list[str]:
            if js(r"^CINOf").search(n):
                return [js(r"^CINOf").sub("PANOf", n, count=1), js(r"^CINOf").sub("PermanentAccountNumberOf", n, count=1)]
            return [js(r"^(?:PANOf|PermanentAccountNumberOf)").sub("CINOf", n, count=1)]

        partner = None
        if js(r"^Either").search(s):
            for tok in (x.group(1) for x in js(r"'?([A-Za-z]+)'?").finditer(s)):
                q = R.concept(tok)
                if q and q != subject and same_table(lambda x, q=q: x == q):
                    partner = q
                    break
            if not partner:
                for cand in swaps(loc):
                    q = R.concept(cand)
                    if q and q != subject and same_table(lambda x, q=q: x == q):
                        partner = q
                        break
        if country and (partner or js(r"^Mandatory").search(s)):
            assert_ = {"op": "or", "args": [entered({"fact": subject}), entered({"fact": partner})]} if partner else entered({"fact": subject})
            return ok("pattern:cin-or-pan-if-india" if partner else "pattern:mandatory-if-india", {"type": "eachFactOf", "concept": country, "when": _upper_eq("INDIA"), "assert": assert_})
    m = ji(r"^Mandatory if 'CINOfSubsidiaryCompany' is entered and (yes|No) is selected in field 'WhetherSubsidiaryHasFiledBalanceSheet'$").search(s)
    if m:
        filed, cin_sub = R.concept("WhetherSubsidiaryHasFiledBalanceSheet"), R.concept("CINOfSubsidiaryCompany")
        return ok("pattern:mandatory-if-entered-and-yes", {
            "type": "eachFactOf", "concept": filed,
            "when": {"op": "and", "args": [cmp("==", SELF, const(bool(ji(r"^yes$").search(m.group(1))))), entered({"fact": cin_sub})]},
            "assert": entered({"fact": subject}),
        })
    if ji(r"^Details of atleast one subsidiary shall be mandatory if yes is selected in field 'WhetherCompanyHasSubsidiaryCompanies'$").search(s):
        q = R.concept("CINOfSubsidiaryCompany")
        tables = [t["id"] for t in A["tables"] if q in t["lineItems"]]
        # gate: the next clause of the same cell says "Subsidiary details can be entered only if yes is selected"
        return ok("pattern:table-conditional", {"type": "tableRequired", "tables": tables, "when": cmp("==", nd(subject), const(True)), "gate": True}, {"periods": ["CY"]})
    if ji(r"^Subsidiary details can be entered only if yes is selected in this field$").search(s):
        q = R.concept("CINOfSubsidiaryCompany")
        tables = [t["id"] for t in A["tables"] if q in t["lineItems"]]
        return ok("pattern:table-only-if-yes", {"type": "assert", "when": {"op": "tableData", "tables": tables}, "assert": cmp("==", nd(subject), const(True))}, {"periods": ["CY"]})
    # -------- cash-flow method
    if ji(r"^Elements for cash flow- direct or indirect shall be applicable based on the value selected in field Type of cash flow").search(s):
        return ok("pattern:cash-flow-method", {"type": "cashFlowMethod", "concept": subject}, {"periods": ["CY", "PY"]})
    # -------- membership mandatory (unquoted member)
    m = ji(r"^Mandatory in case of (\w+Member)$").search(s)
    if m:
        mem = R.concept(m.group(1))
        if mem and A["concepts"][mem]["kind"] == "member":
            return ok("pattern:mandatory-for-member", {"type": "memberMandatory", "concept": subject, "member": mem})

    # -------- conditional mandatory (generic condition grammar)
    m = ji(rf"^{MAND_HEAD}(?: only)?,? (?:if|in case)\s*(.+)$").search(s)
    if m:
        c = parse_condition(trim(m.group(1)), cx)
        if c:
            if c.nondim or all(nondim(q) for q in c.concepts):
                cy_only = any(R.local(q) == "DateOfStartOfReportingPeriod" for q in c.concepts)
                return ok("pattern:mandatory-conditional", {"type": "mandatory", "concept": subject, "when": c.pred(nd)}, {"periods": ["CY"]} if cy_only else None)
            if len(c.concepts) == 1:
                return ok("pattern:mandatory-conditional", {"type": "eachFactOf", "concept": c.concepts[0], "when": c.pred(lambda _q: SELF), "assert": entered({"fact": subject})})
        tok = ji(rf"^{QQ} is entered$").search(trim(m.group(1)))
        if tok and not R.concept(tok.group(1)):
            return {"status": "NOT_APPLICABLE", "reason": f"Condition element '{tok.group(1)}' is not present in the {cx.dts} DTS, so the condition can never be met"}
    return None

