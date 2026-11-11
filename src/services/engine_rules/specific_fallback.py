"""Second pass for clauses the main formalizer (the C&I port) leaves UNIMPLEMENTED.

Two steps, both literal readings of the MCA sentence:
1. *Normalize* wording variants the main patterns don't know (``"yes"`` in double quotes, ``selecetd``,
   ``Mandatory table is …``, ``is other than 0``, a trailing ``in [401100] Notes - …``) and run the main formalizer
   again on the normalized sentence.
2. *Further forms* that only the Ind AS 2017 workbook uses (typed "Others" table sums, members "or its child members",
   "is tagged", "X is more than Y", …).

It only ever sees clauses that would otherwise be UNIMPLEMENTED, so it cannot change a rule the main pass formalizes
(the C&I golden stays identical).
"""
from __future__ import annotations

from typing import Any, Callable

from src.services.engine_rules.jsre import ji, js, trim
from src.services.engine_rules.model import SELF, cmp, const, entered, executable, is_nondim_only, nd
from src.services.engine_rules.specific import (
    MAND_HEAD, QQ, Condition, Context, formalize_specific, parse_condition,
)
from src.services.engine_rules.workbook import SpecificRow

# (pattern, replacement), applied in order. Each reads the same sentence with the wording the main patterns use.
REWRITES: list[tuple[Any, str | Callable]] = [
    (js(r"''"), "'"),
    (js(r'""'), '"'),
    (ji(r"""["']\s*(yes|no)\s*["']"""), lambda m: m.group(1).capitalize()),
    (ji(r"\bselecetd\b"), "selected"),
    (ji(r"^(?:Mandatory table|Table should be mandatory|Table mandatory|Table is mandatory|This table is mandatory) (?:is|if|in case) "), "This table is mandatory if "),
    (ji(r"^(?:This element is a ?mandatory|This is a mandatory field|This is mandatory|Should be mandatory|Mandatory line item|It is mandatory) (if|in case) "), "Mandatory if "),
    (ji(r"\bis selected (?=[\"'])"), "is selected in "),
    (ji(r"\bselected in the element\b"), "selected in element"),
    (ji(r"\bis other than 0\b"), "is other than zero"),
    (ji(r"\b(in case|if) (?:amount|value) entered in "), r"\1 "),
    (ji(r"\s+in\s+(?:in\s+)?\[\s*\d{6}\w?\]\s.*$"), ""),
    (ji(r"\s+in (?:the )?(?:P&L|balance sheet|financial statements?)$"), ""),
    (ji(r"""(?:element )?(["'][^"']+["'])\s*(?:element )?(?:is )?tagged$"""), r"\1 is entered"),
    (ji(r"\bvalid (\w+) is entered$"), r"'\1' is entered"),
]


def normalize(s: str) -> str:
    for rx, rep in REWRITES:
        s = rx.sub(rep, s)
    return trim(s)


# ------------------------------------------------------------------------------------------------- conditions
def _resolve(cx: Context, token: str, row: SpecificRow | None = None) -> str | None:
    """A quoted element or member reference: by name or label; a label shared by several concepts ("Others")
    is resolved within the row's ELR."""
    R, A = cx.R, cx.A
    tok = trim(js(r"\s*\[[^\]]*\]\s*$").sub("", token))
    q = R.concept(tok)
    hits = list(dict.fromkeys(R.by_label.get(_norm(tok), [])))
    if row is not None and row.elr and len(hits) > 1:
        uris = {e["uri"] for e in A["elrs"] if e["code"] == row.elr.code}
        local_hits = [h for h in hits if set(A.get("conceptElrs", {}).get(h, [])) & uris]
        if len(local_hits) == 1:
            return local_hits[0]
    if q:
        return q
    if ji(r"\s+member$").search(tok):
        return R.concept(ji(r"\s+member$").sub("", tok))
    return None


def _norm(s: str) -> str:
    from src.services.engine_rules.resolver import norm

    return norm(s)


def parse_condition_extra(c: str, cx: Context, row: SpecificRow) -> Condition | None:
    """Condition forms beyond the main grammar."""
    A, R = cx.A, cx.R
    base = parse_condition(c, cx)
    if base:
        return base

    def kind(q: str | None) -> str | None:
        return (A["concepts"].get(q) or {}).get("kind") if q else None

    def is_bool(q: str | None) -> bool:
        return bool(q) and A["concepts"][q]["type"] == "xbrli:booleanItemType"

    m = ji(rf"^(?:{QQ}|(\w+)) is entered$").search(c)
    if m:
        q = _resolve(cx, m.group(1) or m.group(2), row)
        if kind(q) == "hypercube":  # a table "is tagged": it has data
            tabs = R.tables_by_hc(R.local(q))
            return Condition([q], lambda ref: {"op": "tableData", "tables": tabs}, nondim=True)
        if q:
            return Condition([q], lambda ref: entered(ref(q)))
    m = ji(rf"^(?:{QQ}|(\w+)) is '?(Yes|No)'?$").search(c)
    if m:
        q = _resolve(cx, m.group(1) or m.group(2), row)
        if is_bool(q):
            v = m.group(3).lower() == "yes"
            return Condition([q], lambda ref: cmp("==", ref(q), const(v)))
    m = ji(rf"^{QQ}\s*or\s*{QQ} is other than zero$").search(c)
    if m:
        a, b = _resolve(cx, m.group(1), row), _resolve(cx, m.group(2), row)
        if kind(a) == "item" and kind(b) == "item":
            return Condition([a, b], lambda ref: {"op": "or", "args": [cmp("!=", ref(q), const(0)) for q in (a, b)]}, nondim=True)
    m = ji(rf"^(?:{QQ}|(\w+)) is other than zero$").search(c)
    if m:
        q = _resolve(cx, m.group(1) or m.group(2), row)
        if kind(q) == "item":
            return Condition([q], lambda ref: cmp("!=", ref(q), const(0)), nondim=True)
    m = ji(rf"^'?(Yes|No)'? (?:is )?selected in (?:field |element )?(?:{QQ}|(\w+))$").search(c)
    if m:
        q = _resolve(cx, m.group(2) or m.group(3), row)
        if is_bool(q):
            v = m.group(1).lower() == "yes"
            return Condition([q], lambda ref: cmp("==", ref(q), const(v)))
    m = ji(rf"^(?:{QQ}|(\w+)) is (other than )?India$").search(c)
    if m:
        q = _resolve(cx, m.group(1) or m.group(2), row)
        if q:
            op = "!=" if m.group(3) else "=="
            return Condition([q], lambda ref: cmp(op, {"upper": ref(q)}, const("INDIA")))
    m = ji(rf"^{QQ} and {QQ} both are (Yes|No)$").search(c)
    if m:
        a, b = _resolve(cx, m.group(1), row), _resolve(cx, m.group(2), row)
        v = m.group(3).lower() == "yes"
        if is_bool(a) and is_bool(b):
            return Condition([a, b], lambda ref: {"op": "and", "args": [cmp("==", ref(q), const(v)) for q in (a, b)]})
    m = ji(rf"^{QQ} is more than {QQ}$").search(c)
    if m:
        a, b = _resolve(cx, m.group(1), row), _resolve(cx, m.group(2), row)
        if kind(a) == "item" and kind(b) == "item":
            return Condition([a, b], lambda ref: cmp(">", ref(a), ref(b)), nondim=True)
    m = ji(rf"^{QQ} is entered with any value except {QQ}$").search(c)
    if m:
        q = _resolve(cx, m.group(1), row)
        if q:
            v = m.group(2).upper()
            return Condition([q], lambda ref: {"op": "and", "args": [entered(ref(q)), cmp("!=", {"upper": ref(q)}, const(v))]})
    m = ji(r"^(\w+) is entered in this table$").search(c)
    if m:
        q = _resolve(cx, m.group(1), row)
        if q:
            return Condition([q], lambda ref: entered(ref(q)))
    return None


# ------------------------------------------------------------------------------------------------- forms
def _members_under(A: dict, member: str) -> list[str]:
    """The member and every member below it on any axis that has it."""
    out = [member]
    for t in A["tables"]:
        for ax in t["axes"]:
            ms = ax.get("members") or []
            if not any(x["member"] == member for x in ms):
                continue
            frontier = [member]
            while frontier:
                p = frontier.pop()
                for x in ms:
                    if x.get("parent") == p and x["member"] not in out:
                        out.append(x["member"])
                        frontier.append(x["member"])
    return out


def _row_tables(A: dict, row: SpecificRow) -> list[str]:
    """Tables of the row's ELR, including its lettered sub-ELRs ([611400] → 611400a, 611400b)."""
    return [t["id"] for t in A["tables"] if row.elr and t["code"][:6] == row.elr.code[:6]]


def formalize_fallback(clause: str, subject: str, row: SpecificRow, cx: Context) -> dict | None:
    A, R = cx.A, cx.R
    s0 = trim(js(r"\s+").sub(" ", js("[‘’´\u0091\u0092]").sub("'", js("[“”\u0093\u0094]").sub('"', clause))))
    s = normalize(s0)
    if s != s0:
        again = formalize_specific(s, subject, row, cx)
        if again["status"] != "UNIMPLEMENTED":
            return again

    def ok(impl: str, ast: dict, scope: dict | None = None) -> dict:
        return executable(impl, ast, scope)

    concept = A["concepts"][subject]
    is_table = concept["kind"] == "hypercube"
    tables = R.tables_by_hc(R.local(subject)) if is_table else []

    # -------- informational / restated / external
    if ji(r"^There are \d+ tables in this ELR$").search(s):
        return {"status": "NOT_APPLICABLE", "reason": "Informational: describes the ELR, imposes no constraint (the next clause carries the rule)"}
    if ji(r"^If Yes is selected then 'Balance Sheet' for preceding previous year is mandatory$").search(s):
        return {"status": "EXECUTABLE", "implementation": "data:executed by the generic first-time-adoption rule (opening balance sheet of the previous year)", "scope": {"periods": ["CY"]}}
    if ji(r"company (?:not )?having equity share capital|section 8 company").search(s):
        return {"status": "REVIEW_ONLY_EXTERNAL_DATA", "implementation": "review:external-master-data", "reason": "Requires company class / share-capital status from MCA21 company master data, which is not part of the instance document"}
    if ji(r"^Should be based on .+, if provided$").search(s):
        return {"status": "REVIEW_ONLY_EXTERNAL_DATA", "implementation": "review:external-data", "reason": "Name must match the MCA21 master record of the CIN entered — master data is not part of the instance document"}

    # -------- table-level
    if is_table and tables:
        if ji(r"^Mandatory table$").search(s):
            return ok("pattern:table-mandatory", {"type": "tableRequired", "tables": tables, "when": None}, {"periods": ["CY", "PY"]})
        m = ji(rf"^{MAND_HEAD}(?: only)?,? (?:if|in case) (.+)$").search(s)
        if m:
            c = parse_condition_extra(trim(m.group(1)), cx, row)
            if c and (c.nondim or all(is_nondim_only(q, A) for q in c.concepts)):
                return ok("pattern:table-conditional", {"type": "tableRequired", "tables": tables, "when": c.pred(nd), "gate": False}, {"periods": ["CY", "PY"]})
        m = ji(rf"^(?:This )?table is mandatory if amount of {QQ}(?: in Balance Sheet)? is greater than zero AND {QQ} is not tagged$").search(s)
        if m:
            q, other = _resolve(cx, m.group(1), row), R.tables_by_hc(trim(m.group(2)) if trim(m.group(2)).endswith("Table") else trim(m.group(2)) + "Table")
            if q and other:
                return ok("pattern:table-if-gt0-unless-other", {"type": "tableRequired", "tables": tables, "when": {"op": "and", "args": [cmp(">", nd(q), const(0)), {"op": "not", "arg": {"op": "tableData", "tables": other}}]}, "gate": False}, {"periods": ["CY", "PY"]})
        if ji(r"^This table is mandatory for current year if transaction period from 8th November 2016 to 30th December 2016 is overlapping").search(s):
            start, end = R.concept("DateOfStartOfReportingPeriod"), R.concept("DateOfEndOfReportingPeriod")
            return ok("curated:specified-bank-notes-period", {"type": "tableRequired", "tables": tables, "when": {"op": "and", "args": [
                cmp("<=", nd(start), {"const": "2016-12-30", "kind": "date"}), cmp(">=", nd(end), {"const": "2016-11-08", "kind": "date"})]}, "gate": False}, {"periods": ["CY"]})

    # -------- "all line items" written on each line item: that item is mandatory under the condition
    m = ji(r"^All line items should be mandatory if (.+)$").search(s)
    if m and concept["kind"] == "item":
        c = parse_condition_extra(trim(m.group(1)), cx, row)
        if c and (c.nondim or all(is_nondim_only(q, A) for q in c.concepts)):
            return ok("pattern:mandatory-conditional", {"type": "mandatory", "concept": subject, "when": c.pred(nd)})

    # -------- one of two elements (accounting estimates [610300]): the first sentence, cut at "i.e."
    if ji(r"^One of these two elements should be mandatory i\.?e\.?$").search(s):
        return _one_of_two(subject, row, cx, ok)
    if ji(r"^If one is tagged then other one should not be mandatory, when table is created$").search(s):
        return {"status": "NOT_APPLICABLE", "reason": "Permissive statement: relaxes the previous sentence (either element suffices), imposes no constraint of its own"}

    # -------- curated sums of a note table against the face of the balance sheet
    x = _note_sums(s, subject, row, cx, ok)
    if x:
        return x

    # -------- "one of the tables" / all line items of the row's tables
    m = ji(rf"^(?:One of the table should be entered|All line items should be mandatory) if (.+)$").search(s)
    if m:
        c = parse_condition_extra(trim(m.group(1)), cx, row)
        tabs = tables or _row_tables(A, row) or R.tables_by_hc(js(r"(LineItems|Abstract)$").sub("Table", R.local(subject), count=1))
        if c and tabs and (c.nondim or all(is_nondim_only(q, A) for q in c.concepts)):
            return ok("pattern:table-conditional", {"type": "tableRequired", "tables": tabs, "when": c.pred(nd), "gate": False}, {"periods": ["CY", "PY"]})

    # -------- typed "Others" table: Σ over its members = the face figure
    m = ji(rf"^Summation of value entered in all dimensional members of (\w+Table) for {QQ} should be equal to {QQ}").search(s)
    if m:
        hc_tables = [t for t in A["tables"] if t["hypercube"].split(":")[1] == m.group(1)]
        typed = next((a for t in hc_tables for a in t["axes"] if a["typed"]), None)
        part, total = _resolve(cx, m.group(2), row), _resolve(cx, m.group(3), row)
        if typed and part and total:
            return ok("pattern:typed-table-sum", {"type": "assert", "assert": cmp("==", {"sumAxis": {"concept": part, "axis": typed["axis"], "level": "all"}}, nd(total))})

    # -------- member-conditional
    m = (
        ji(rf"^Mandatory,? (?:if|in case of(?: the member)?) {QQ}(?: or its child members)?(?: (?:is|are) (?:used|selected))?$").search(s)
        or ji(rf"^This shall be mandatory in case details in respect of {QQ}(?: or its child members)? is entered$").search(s)
    )
    if m:
        mem = _resolve(cx, m.group(1), row)
        if mem and A["concepts"][mem]["kind"] == "member":
            ast = {"type": "memberMandatory", "concept": subject, "member": mem}
            if ji(r"or its child members").search(s):
                ast["members"] = _members_under(A, mem)
            return ok("pattern:mandatory-for-member", ast)

    # -------- CIN / PAN if country is India
    m = ji(r"^Either (?:.+) (?:is|should be) mandatory if (?:Country(?: of incorporation)?|\w*Country\w*) is India$").search(s)
    if m:
        same = [q for t in A["tables"] if subject in t["lineItems"] for q in t["lineItems"]]
        country = next((q for q in same if js(r"^CountryOf").search(R.local(q))), None)
        loc = R.local(subject)
        cands = [js(r"^CINOf").sub(p, loc, count=1) for p in ("PermanentAccountNumberOf", "PANOf")] if loc.startswith("CINOf") else \
            [js(r"^(?:PermanentAccountNumberOf|PANOf)").sub("CINOf", loc, count=1)]
        cands += [x.group(1) for x in js(r"['\"](\w+)['\"]").finditer(s)]
        partner = next((q for q in (R.concept(c) for c in cands) if q and q != subject and q in same), None)
        if country and partner:
            return ok("pattern:cin-or-pan-if-india", {"type": "eachFactOf", "concept": country, "when": cmp("==", {"upper": SELF}, const("INDIA")),
                                                       "assert": {"op": "or", "args": [entered({"fact": subject}), entered({"fact": partner})]}})

    # -------- values / scope
    m = ji(rf"^Only {QQ} and {QQ} can be selected for the time being$").search(s)
    if m:
        return ok("pattern:eq-one-of", {"type": "eachFact", "concept": subject, "assert": {"op": "or", "args": [cmp("==", SELF, const(m.group(1))), cmp("==", SELF, const(m.group(2)))]}}, {"periods": ["CY"]})
    if ji(r"^Mandatory for current year only").search(s) and is_table:
        # a note on the cell's table rule (previous clause), not a rule of its own: the formalizer narrows that rule
        return {"status": "EXECUTABLE", "implementation": "data:limits the previous clause of the same cell to the current year", "scopeOfPrevious": {"periods": ["CY"]}}
    m = ji(rf"^Summation of {QQ} for\s+{QQ} should be equal to value entered in {QQ}").search(s)
    if m and ji(r"EquitySharesMembers 1\.\.10").search(m.group(2)):
        axis, total = R.concept("ClassesOfEquityShareCapitalAxis"), _resolve(cx, m.group(3), row)
        if axis and total:
            return ok("curated:equity-classes-sum", {"type": "assert", "assert": cmp("==", {"sumAxis": {"concept": subject, "axis": axis, "pattern": r"^EquityShares\d+Member$", "level": "pattern"}}, nd(total))})
    if ji(r"^Mandatory for current year only").search(s):
        return ok("pattern:mandatory-current-year", {"type": "mandatory", "concept": subject}, {"periods": ["CY"]})
    m = ji(r"^Mandatory if above (subsidiary|joint venture|associate) table is filled$").search(s)
    if m:
        word = {"subsidiary": "Subsidiar", "joint venture": "JointVenture", "associate": "Associate"}[m.group(1).lower()]
        tabs = [t for t in _row_tables(A, row) if word in t.split(":")[1] and subject not in cx.R.table_def(t)["lineItems"]]
        if tabs:
            return ok("pattern:mandatory-if-table", {"type": "mandatory", "concept": subject, "when": {"op": "tableData", "tables": tabs}}, {"periods": ["CY"]})

    # -------- conditional mandatory with the extra condition grammar
    m = ji(rf"^{MAND_HEAD}(?: only)?,? (?:if|in case)\s*(.+)$").search(s)
    if m and not is_table:
        c = parse_condition_extra(trim(m.group(1)), cx, row)
        if c:
            if c.nondim or all(is_nondim_only(q, A) for q in c.concepts):
                return ok("pattern:mandatory-conditional", {"type": "mandatory", "concept": subject, "when": c.pred(nd)})
            if len(c.concepts) == 1:
                return ok("pattern:mandatory-conditional", {"type": "eachFactOf", "concept": c.concepts[0], "when": c.pred(lambda _q: SELF), "assert": entered({"fact": subject})})
    return None


# ------------------------------------------------------------------------------------------------- curated
# Ind AS [610300] rows 2685/2686 carry the same sentence ("One of these two elements should be mandatory i.e …"):
# the two elements are those two rows.
ONE_OF_TWO = ("IncreaseDecreaseInAccountingEstimate", "DescriptionOfFactThatAmountOfChangeInAccountingEstimateIsImpracticableExplanatory")


def _one_of_two(subject: str, row: SpecificRow, cx: Context, ok) -> dict | None:
    R, A = cx.R, cx.A
    pair = [R.concept(n) for n in ONE_OF_TWO]
    if subject not in pair or not all(pair):
        return None
    tables = [t["id"] for t in A["tables"] if subject in t["lineItems"]]
    args = [{"op": "existsFact", "concept": q, "pred": entered(SELF)} for q in pair]
    return ok("curated:one-of-two-accounting-estimate", {"type": "assert", "when": {"op": "tableData", "tables": tables}, "assert": {"op": "or", "args": args}})


def _axis(A: dict, subject: str, local: str) -> str | None:
    return next((a["axis"] for t in A["tables"] if subject in t["lineItems"] for a in t["axes"] if a["axis"].split(":")[1] == local), None)


def _axis_with_member(A: dict, subject: str, member: str) -> str | None:
    return next((a["axis"] for t in A["tables"] if subject in t["lineItems"] for a in t["axes"]
                 if any(m["member"] == member for m in a.get("members") or [])), None)


def _note_sums(s: str, subject: str, row: SpecificRow, cx: Context, ok) -> dict | None:
    """Σ of a note table on its members (first level, or listed) = the balance-sheet figure, as the MCA sentence says."""
    A, R = cx.A, cx.R
    time = _axis(A, subject, "ClassificationBasedOnCurrentNoncurrentAxis")
    term = {"noncurrent": R.concept("NoncurrentMember"), "current": R.concept("CurrentMember")}

    def eq(sum_spec: dict, total: str | None) -> dict:
        return cmp("==", {"sumAxis": sum_spec}, nd(total))

    # Borrowings [400300]: first-level members of ClassificationOfBorrowingsAxis, per current / non-current
    m = ji(rf"^Summation of various Borrowings members for (NonCurrent|Current) period should be equal to {QQ}").search(s)
    if m and time:
        axis = _axis(A, subject, "ClassificationOfBorrowingsAxis")
        total = _resolve(cx, m.group(2), row)
        if axis and total:
            return ok("curated:borrowings-first-level", {"type": "assert", "assert": eq(
                {"concept": subject, "axis": axis, "level": "firstLevel", "fixed": {time: term[m.group(1).lower()]}}, total)})
    # Loans / Advances [401100]: first-level members, non-current and current
    m = ji(rf"^Summation of all (Loans|Advances) - Non-current member and current member should be equal to (?:{QQ}|(\w+)) and (?:{QQ}|(\w+)) respectively").search(s)
    if m and time:
        axis = _axis(A, subject, f"ClassificationOf{m.group(1)}Axis")
        nc, cu = _resolve(cx, m.group(2) or m.group(3), row), _resolve(cx, m.group(4) or m.group(5), row)
        if axis and nc and cu:
            return ok(f"curated:{m.group(1).lower()}-term-sum", {"type": "assert", "assert": {"op": "and", "args": [
                eq({"concept": subject, "axis": axis, "level": "firstLevel", "fixed": {time: term["noncurrent"]}}, nc),
                eq({"concept": subject, "axis": axis, "level": "firstLevel", "fixed": {time: term["current"]}}, cu)]}})
    # Provisions [401100]: the non-current and current members
    m = ji(rf"^Summation of all Provisions - NoncurrentMember and CurrentMember should be equal to {QQ} and {QQ} respectively").search(s)
    if m and time:
        nc, cu = _resolve(cx, m.group(1), row), _resolve(cx, m.group(2), row)
        if nc and cu:
            return ok("curated:provisions-term-sum", {"type": "assert", "assert": {"op": "and", "args": [
                eq({"concept": subject, "axis": time, "level": "members", "members": [term["noncurrent"]]}, nc),
                eq({"concept": subject, "axis": time, "level": "members", "members": [term["current"]]}, cu)]}})
    # Trade receivables [401100]: listed members on the security axis, per current / non-current
    m = ji(rf"^Summation of (\w+) - (\w+); (\w+); (\w+) on {QQ} should be equal to {QQ}").search(s)
    if m and R.concept(m.group(1)) == subject:
        members = [R.concept(n) for n in (m.group(2), m.group(3), m.group(4))]
        axis = _axis_with_member(A, subject, members[0]) if all(members) else None
        on = R.concept(js(r"^NonCurrentMember$").sub("NoncurrentMember", trim(m.group(5))))
        on_axis = _axis_with_member(A, subject, on) if on else None
        total = _resolve(cx, m.group(6), row)
        if axis and on_axis and total:
            return ok("pattern:listed-members-sum", {"type": "assert", "assert": eq(
                {"concept": subject, "axis": axis, "level": "members", "members": members, "fixed": {on_axis: on}}, total)})
    # PPE / investment property / other intangible assets: carrying amount over the classes = balance sheet
    carrying = R.concept("CarryingAmountMember")
    carrying_axis = _axis_with_member(A, subject, carrying) if carrying else None
    m = (ji(r"^Summation of this element on all the members should be equal to the corresponding value(?: in Balance Sheet)?$").search(s)
         or ji(rf"^Summation of carrying amount value entered in all dimensional members for each .+ should be equal to {QQ} value entered(?: in Balance sheet)?$").search(s))
    if m and carrying_axis:
        total = _resolve(cx, m.group(1), row) if m.groups() else subject
        classes = next((a for t in A["tables"] if subject in t["lineItems"] for a in t["axes"] if a["axis"] != carrying_axis), None)
        if classes and total:
            level = "all" if classes["typed"] else "firstLevel"
            return ok("curated:carrying-amount-classes-sum", {"type": "assert", "assert": eq(
                {"concept": subject, "axis": classes["axis"], "level": level, "fixed": {carrying_axis: carrying}}, total)})
    # Goodwill [400800]: the carrying amount = balance sheet
    m = ji(rf"^This value if {QQ} should be equal to {QQ} on the face of Balance Sheet$").search(s)
    if m:
        mem, total = _resolve(cx, m.group(1), row), _resolve(cx, m.group(2), row)
        axis = _axis_with_member(A, subject, mem) if mem else None
        if axis and total:
            return ok("curated:carrying-amount-eq-face", {"type": "assert", "assert": eq({"concept": subject, "axis": axis, "level": "members", "members": [mem]}, total)})
    # Biological assets [401000]: fair-value table + carrying amount of the cost table = balance sheet
    m = ji(rf"^Summation of (?:carrying amount )?value in {QQ} and (?:carrying amount value in )?{QQ} entered in all dimensional members for each biological assets should be equal to {QQ}").search(s)
    if m:
        a, b, total = (_resolve(cx, m.group(i), row) for i in (1, 2, 3))
        if a and b and total:
            parts = []
            for q in (a, b):
                t = next((t for t in A["tables"] if q in t["lineItems"]), None)
                typed = next((x for x in (t or {}).get("axes", []) if x["typed"]), None)
                if not typed:
                    return None
                spec = {"concept": q, "axis": typed["axis"], "level": "all"}
                c_axis = _axis_with_member(A, q, carrying) if carrying else None
                if c_axis:
                    spec["fixed"] = {c_axis: carrying}
                parts.append({"sumAxis": spec})
            return ok("curated:biological-assets-sum", {"type": "assert", "assert": cmp("==", {"add": parts}, nd(total))})
    # Other equity [400200]: closing balance on the parent's member = balance sheet; on the NCI member when consolidated
    if ji(r"^Value of Other equity- \(Closing Balance\) on the dimensional member 'EquityAttributableToTheEquityHoldersOfTheParentMember' should be equal to value entered in 'Other equity'").search(s):
        parent, nci = R.concept("EquityAttributableToTheEquityHoldersOfTheParentMember"), R.concept("NonControllingInterestsMember")
        axis = _axis_with_member(A, subject, parent)
        if axis and nci:
            consolidated = {"op": "reportType", "value": "Consolidated"}
            return ok("curated:other-equity-eq-face", {"type": "assert", "assert": {"op": "and", "args": [
                eq({"concept": subject, "axis": axis, "level": "members", "members": [parent]}, R.concept("OtherEquity")),
                {"op": "or", "args": [{"op": "not", "arg": consolidated},
                                      eq({"concept": subject, "axis": axis, "level": "members", "members": [nci]}, R.concept("NonControllingInterest"))]},
            ]}})
    # Share capital [400100]: not above the subscribed value of the equity classes
    if ji(r'^Should be less than or equal to "Value of shares subscribed - equity').search(s):
        axis, subscribed = R.concept("ClassesOfEquityShareCapitalAxis"), R.concept("ValueOfSharesSubscribed")
        if axis and subscribed:
            return ok("curated:sharecapital-lte-subscribed", {"type": "assert", "assert": cmp(
                "<=", nd(subject), {"sumAxis": {"concept": subscribed, "axis": axis, "level": "firstLevel"}})})
    return None
