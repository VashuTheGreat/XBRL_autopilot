"""The "Mandatory line items" sheet: table → the line items every reported member must carry (generic rule 2)."""
from __future__ import annotations

from src.services.engine_rules.jsre import ji, js, trim
from src.services.engine_rules.resolver import Resolver

# Row-scoped token corrections: the C&I 2016 table has a single combined element for the name.
ML_TOKEN_ALIASES = {
    "DisclosureOfKeyManagerialPersonnelsAndDirectorsAndRemunerationToKeyManagerialPersonnelsAndDirectorsTable": {"NameOfDirector": "NameOfKeyManagerialPersonnelOrDirector"},
}
# Evidence (MCA-validated FILING-A_2024-25.xml): Key Management Personnel rows whose only transaction is
# RemunerationForKeyManagerialPersonnel (sibling TransactionRelatingToKeyManagementPersonnelAbstract) were accepted,
# so transactions reported under that abstract also satisfy "at least one transaction".
AT_LEAST_ONE_ALSO = {"RelatedPartyTransactionsAbstract": ["TransactionRelatingToKeyManagementPersonnelAbstract"]}
# The C&I "Changes to Business Rules" sheet (row 7) adds a mandatory line item to a table.
CHANGE_ADDITIONS = {"DetailsOfMaterialContractsArrangementsTransactionsAtArmsLengthBasisTable": ["WhetherApprovalTakenFromBoardForMaterialContractsorArrangementsorTransactionsWithRelatedParty"]}

_TOKEN = js(r"[A-Z][A-Za-z0-9-]{5,}")
_PAREN = js(r"\([^)]*\)")
_HEAD = ji(r"^(Mandatory elements are|Elements mandatory are|Mandatory Elements are|Elements mandatory|Element for 'Provisions' is mandatory)\s*[-:;]?\s*")


def _uniq(xs: list) -> list:
    return list(dict.fromkeys(xs))


def descendants(tdefs: list[dict], abstract: str | None) -> list[str]:
    out: list[str] = []
    for t in tdefs:
        kids: dict[str, list[str]] = {}
        for n in t["lineItemTree"]:
            kids.setdefault(n["parent"], []).append(n["concept"])
        stack = [abstract]
        while stack:
            c = stack.pop()
            for k in kids.get(c, []):
                out.append(k)
                stack.append(k)
    return _uniq(out)


def formalize_mandatory_line_items(row: dict, R: Resolver, A: dict, dts: str) -> dict:
    tname = trim(
        js(r"LineItems$").sub("Table", js(r"\s+").sub("", ji(r"\s+in\s+Notes.*$").sub("", js(r"'.*$").sub("", row["table"], count=1), count=1)), count=1)
    )
    tables = R.table(tname) or R.table(tname + "Table")
    if not tables:
        return {"status": "NOT_APPLICABLE", "reason": f"Table '{row['table']}' not present in the {dts} DTS"}
    tdefs = [R.table_def(i) for i in tables]
    line_items = _uniq([q for t in tdefs for q in t["lineItems"]])
    text = js(r"\s+").sub(" ", row["text"])
    unresolved: list[str] = []
    aliases = ML_TOKEN_ALIASES.get(R.local(tdefs[0]["hypercube"]), {})

    def tokens(s: str) -> list[str]:
        return _TOKEN.findall(_PAREN.sub(" ", s))

    def resolve_list(s: str) -> list[str]:
        out = []
        for tk in tokens(s):
            q = R.concept(aliases.get(tk) or tk.replace("-", ""))
            if not q or q not in line_items:
                unresolved.append(tk)
                continue
            out.append(q)
        return out

    mandatory: list[str] = []
    at_least_one: list[list[str]] = []
    notes: list[str] = []
    if ji(r"^All elements are mandatory except").search(text) or ji(r"^All elements mandatory except").search(text):
        mode = "all-except"
        except_part = ji(r"^All elements (are )?mandatory except( for)?( -)?").sub("", text, count=1)
        m = ji(r"elements in (\w+Abstract)").search(except_part)
        if m:
            under = descendants(tdefs, R.concept(m.group(1)))
            mandatory = [q for q in line_items if q not in under]
        else:
            ex = set(resolve_list(js(r"\b(and)\b").sub(" ", except_part)))
            mandatory = [q for q in line_items if q not in ex]
    elif ji(r"^All elements are mandatory$").search(text):
        mode = "all"
        mandatory = list(line_items)
    else:
        mode = "list"
        body = _HEAD.sub(lambda x: "Provisions " if js("Provisions").search(x.group(0)) else "", text, count=1)
        while ae := ji(r"All elements in (\w+Abstract)").search(body):
            mandatory.extend(q for q in descendants(tdefs, R.concept(ae.group(1))) if not A["concepts"][q].get("abstract"))
            body = body.replace(ae.group(0), "", 1)
        al = ji(r"Atleast one element in (\w+Abstract)").search(body)
        if al:
            abstract = R.concept(al.group(1))
            group = descendants(tdefs, abstract)
            for extra in AT_LEAST_ONE_ALSO.get(R.local(abstract), []):
                group.extend(descendants(tdefs, R.concept(extra)))
            at_least_one.append(_uniq(group))
            body = body.replace(al.group(0), "", 1)
        ob = ji(r"In (OutstandingBalancesForRelatedPartyTransactionsAbstract)- Element for amount shall be mandatory for various transactions,?").search(body)
        if ob:
            notes.append(js(r",$").sub("", trim(ob.group(0)), count=1))
            body = body.replace(ob.group(0), "", 1)
        mandatory.extend(resolve_list(body))
    for add in CHANGE_ADDITIONS.get(R.local(tdefs[0]["hypercube"]), []):
        q = R.concept(add)
        if q and q not in mandatory:
            mandatory.append(q)
    res: dict = {
        "status": "EXECUTABLE",
        "implementation": f"pattern:mandatory-line-items-{mode}",
        "ast": {"type": "lineItemsMandatory", "tables": tables, "concepts": _uniq(mandatory), "atLeastOne": at_least_one},
        "scope": {"periods": ["CY", "PY"]},
    }
    if notes:
        res["partial"] = True
        res["ambiguous"] = "; ".join(notes)
    if unresolved:
        res["reason"] = f"Tokens not matching a line item of the table in the {dts.split()[-1]} DTS (not executable): {', '.join(_uniq(unresolved))}"
        res["unresolvedReason"] = res["reason"]
    return res
