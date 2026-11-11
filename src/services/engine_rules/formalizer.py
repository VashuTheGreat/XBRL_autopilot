"""Rule workbook → rule model (executable ASTs, exemptions, applicability) + coverage ledger.

Port of ``compileBusinessRules`` (``engine/compiler/rule-formalizer.mjs``). Keys are inserted in the order the
JavaScript built them, so the JSON is identical (ADR-0011 golden check).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from src.services.engine_rules.coverage import describe, op_of, operands_of, test_of
from src.services.engine_rules.exemptions import data_status, resolve_exempt, resolve_pc_exempt
from src.services.engine_rules.generic import Handler
from src.services.engine_rules.jsre import ji, js, trim
from src.services.engine_rules.mandatory_items import formalize_mandatory_line_items
from src.services.engine_rules.model import UNDEF, is_nondim_only
from src.services.engine_rules.resolver import Resolver
from src.services.engine_rules.specific import Context, formalize_specific, split_clauses
from src.services.engine_rules.specific_fallback import formalize_fallback
from src.services.engine_rules.workbook import (
    SpecificRules, Workbook, applicable_elrs, change_rules, country_names, exempt_member_sheets,
    generic_rules, mandatory_line_item_sheets, parent_child_exempt_sheets, read_workbook,
)


@dataclass(frozen=True)
class FormalizerConfig:
    dts: str  # "C&I 2016", named in NOT_APPLICABLE reasons
    generic: dict[int, Handler]
    specific_rules: Callable[[Workbook], SpecificRules]
    extra_split: str | None = None  # a JS regex source
    # whether a Yes/No answer also restricts availability (fields / tables of the other answer are not filing data)
    yes_no_restricts: bool = True


_STATUSES = ["EXECUTABLE", "EXECUTED", "REVIEW_ONLY_EXTERNAL_DATA", "UNIMPLEMENTED", "NOT_APPLICABLE"]
_CHANGE_DATE = js(r'^Mandatory if "?DateOfStartOfReportingPeriod"? is more than (\d{2})/(\d{2})/(\d{4})$')
_ELR_CODE6 = js(r"^\[(\d{6})")


def _elr_label(elr) -> str | None:
    return f"[{elr.code}] {elr.title}" if elr else None


def compile_business_rules(path: Path, A: dict, cfg: FormalizerConfig) -> tuple[dict, dict]:
    wb = read_workbook(path)
    R = Resolver(A)
    cx = Context(A=A, R=R, dts=cfg.dts)
    rules: list[dict] = []

    # ------------------------------------------------------------ specific rules
    spec = cfg.specific_rules(wb)
    for row in spec.rows:
        # Ind AS rows name the prefix too: an element of that exact qname wins over a name/label match
        qualified = f"{row.prefix}:{row.element}" if row.prefix else None
        subject = qualified if qualified in A["concepts"] else R.concept(row.element)
        clauses = split_clauses(row.text)
        if cfg.extra_split:
            clauses = [trim(c) for part in clauses for c in js(cfg.extra_split).split(part) if trim(c)]
        for i, text in enumerate(clauses):
            base = {
                "id": f"SR-L{row.line}-{i + 1}",
                "family": "specific",
                "source": {"sheet": row.sheet, "line": row.line, "elr": _elr_label(row.elr), "element": row.element, "text": row.text, "clause": text},
                "subject": subject,
            }
            if not subject:
                rules.append({**base, "status": "NOT_APPLICABLE", "reason": f"Element '{row.element}' not present in the {cfg.dts} DTS"})
                continue
            res = formalize_specific(text, subject, row, cx)
            if res["status"] == "UNIMPLEMENTED":
                res = formalize_fallback(text, subject, row, cx) or res
            ast = res.get("ast") or {}
            if res["status"] == "EXECUTABLE" and ast.get("type") == "mandatory" and A["concepts"][subject].get("abstract") and not ast.get("when"):
                res = {"status": "NOT_APPLICABLE", "reason": "Abstract element: cannot carry a value (a heading); its line items carry their own rules"}
            if "scopeOfPrevious" in res:
                narrowed = res.pop("scopeOfPrevious")
                prev = rules[-1] if rules and rules[-1]["id"].startswith(f"SR-L{row.line}-") else None
                if prev is not None and prev["status"] == "EXECUTABLE":
                    prev["scope"] = narrowed
            rules.append({**base, **res})

    # ------------------------------------------------------------ changes sheet
    for row in change_rules(wb):
        base = {"id": f"CH-{row['no']}", "family": "change", "source": {"sheet": row["sheet"], "line": row["line"], "element": row["element"], "text": row["text"], "clause": row["text"], "tab": row["tab"]}}
        q = R.concept(row["element"]) or R.table(row["element"])
        m = _CHANGE_DATE.search(row["text"])
        if not q:
            rules.append({**base, "status": "NOT_APPLICABLE", "reason": f"Element/table '{row['element']}' not present in the {cfg.dts} DTS (change introduced for a later taxonomy)"})
            continue
        if m:
            date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
            rules.append({**base, "subject": q, "status": "EXECUTABLE", "implementation": "pattern:change-date-mandatory", "scope": {"periods": ["CY"]},
                          "ast": {"type": "mandatory", "concept": q, "when": {"op": "cmp", "cmp": ">", "l": {"fact": R.concept("DateOfStartOfReportingPeriod")}, "r": {"const": date, "kind": "date"}}}})
        elif ji(r"Manda\w* Line Item").search(row["tab"]) and R.table(row["element"]) and R.concept(row["text"]):
            rules.append({**base, "subject": R.concept(row["text"]), "status": "EXECUTABLE", "implementation": "data:merged into mandatory-line-items rule for the same table", "scope": {"periods": ["CY", "PY"]}})
        else:
            rules.append({**base, "subject": q, "status": "UNIMPLEMENTED", "reason": "Unrecognised change-rule form"})

    # ------------------------------------------------------------ generic rules
    for g in generic_rules(wb):
        handler = cfg.generic.get(g["no"])
        body = handler(A, R, wb) if handler else {"status": "UNIMPLEMENTED", "reason": "No generic handler"}
        rules.append({"id": f"GR-{g['no']}", "family": "generic", "source": {"sheet": "Generic rules", "line": g["line"], "text": g["text"], "clause": g["text"]}, **body})

    # ------------------------------------------------------------ mandatory line items
    ml_sheets = mandatory_line_item_sheets(wb)
    primary = ml_sheets[0] if ml_sheets else None
    for si, sheet in enumerate(ml_sheets):
        for row in sheet["rows"]:
            base = {"id": f"ML{'L' if si else ''}-{row['no']}", "family": "mandatory-line-items", "source": {"sheet": sheet["sheet"], "line": row["line"], "table": row["table"], "text": row["text"], "clause": row["text"]}}
            if si > 0:
                dup = next((p for p in primary["rows"] if p["no"] == row["no"]), None)
                rules.append({**base, "status": "NOT_APPLICABLE", "reason": f"Legacy duplicate sheet '{sheet['sheet']}' (older element names); superseded by '{primary['sheet']}' row {dup['no'] if dup else '?'} which is executed"})
                continue
            res = formalize_mandatory_line_items(row, R, A, cfg.dts)
            if res.get("partial"):
                main = {k: v for k, v in res.items() if k != "ambiguous"}
                rules.append({**base, **main, "status": "EXECUTABLE", "reason": main.get("unresolvedReason") or None, "partial": UNDEF})
                rules.append({**base, "id": base["id"] + "-b", "source": {**base["source"], "clause": res["ambiguous"]}, "status": "UNIMPLEMENTED",
                              "reason": "Ambiguous in the MCA source: does not identify which amount elements are required, so it cannot be formalized without an MCA clarification"})
            else:
                rules.append({**base, **res})

    # ------------------------------------------------------------ data sheets consumed by generic rules
    ex_parent = exempt_member_sheets(wb, "parent")
    ex_child = exempt_member_sheets(wb, "child")
    pc_exempt = parent_child_exempt_sheets(wb)
    exemptions = {
        "parentMember": resolve_exempt(ex_parent[0] if ex_parent else None, R),
        "childMember": resolve_exempt(ex_child[0] if ex_child else None, R),
        "calculation": resolve_pc_exempt(pc_exempt[0] if pc_exempt else None, R, A),
    }
    for prefix, family, sheets in (("EXP", "exempt-parent-member", ex_parent), ("EXC", "exempt-child-member", ex_child)):
        for si, s in enumerate(sheets):
            for i, r in enumerate(s["rows"]):
                rules.append({"id": f"{prefix}{'L' if si else ''}-{i + 1}", "family": family,
                              "source": {"sheet": s["sheet"], "line": r["line"], "text": f"{_s(r['table'])} | {_s(r['axis'])} | {_s(r['member'])}", "clause": ""},
                              **data_status(si, r, R, "GR-3", cfg.dts)})
    for si, s in enumerate(pc_exempt):
        for i, r in enumerate(s["rows"]):
            rules.append({"id": f"PCE{'L' if si else ''}-{i + 1}", "family": "exempt-calculation",
                          "source": {"sheet": s["sheet"], "line": r["line"], "text": f"{r['abstract']} | {r['text']}", "clause": ""},
                          "status": "EXECUTABLE", "implementation": "data:GR-1 exemption list"})

    countries = country_names(wb)
    elr_sheet = applicable_elrs(wb)

    boolean_dependencies = _boolean_dependencies(rules, A, restricts=cfg.yes_no_restricts)
    table_applicability: dict[str, list] = {}
    for r in rules:
        ast = r.get("ast")
        if r["status"] == "EXECUTABLE" and ast and ast.get("type") == "tableRequired" and ast.get("when") and ast.get("gate", UNDEF) is not False:
            for t in ast["tables"]:
                table_applicability.setdefault(t, []).append({"rule": r["id"], "when": ast["when"]})

    # ------------------------------------------------------------ coverage
    summary: dict[str, int] = {}
    for r in rules:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    elr_seq = list({row.elr.code: row.elr for row in spec.rows if row.elr}.values())
    corpus = {
        "sourceFile": path.name,
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "sourceForm": wb.form,
        "sheets": [{"name": s.name, "rows": len(s.rows), "truncated": s.truncated} for s in wb.sheets],
        "specificRuleRows": len(spec.rows),
        "genericRuleCount": len(generic_rules(wb)),
        "mandatoryLineItemRows": len(ml_sheets[0]["rows"]) if ml_sheets else 0,
        "firstElrInSpecificRules": _elr_label(elr_seq[0]) if elr_seq else None,
        "lastElrInSpecificRules": _elr_label(spec.last_elr),
        "specificRulesSheetTruncated": spec.truncated,
        "truncatedSheets": [s.name for s in wb.sheets if s.truncated],
        "truncationNote": spec.truncation_note or None,
        "lastElrInSuppliedSpecificRules": _elr_label(spec.last_elr),
        "elrsWithoutSuppliedSpecificRules": [],
        "note": None,
    }
    coverage = {
        "generatedBy": "src/services/engine_rules",
        "source": path.name,
        "statuses": list(_STATUSES),
        "summary": summary,
        "corpus": corpus,
        "rules": [
            {
                "ruleId": r["id"], "family": r["family"], "sourceSheet": r["source"]["sheet"], "sourceRow": r["source"]["line"],
                "sourceText": r["source"]["text"], "clause": r["source"]["clause"],
                "element": r["source"].get("element") or r["source"].get("table") or None,
                "subject": r.get("subject") or None,
                "condition": describe(r["ast"].get("when")) if r.get("ast") else None,
                "operator": op_of(r["ast"]) if r.get("ast") else None,
                "operands": operands_of(r["ast"]) if r.get("ast") else [],
                "scope": r.get("scope") or None,
                "implementation": r.get("implementation") or None,
                "test": test_of(r),
                "status": r["status"],
                "reason": r.get("reason") or None,
            }
            for r in rules
        ],
    }
    model = {
        "rules": [
            {
                "id": r["id"], "family": r["family"], "status": r["status"],
                "implementation": r.get("implementation", UNDEF), "scope": r.get("scope", UNDEF), "subject": r.get("subject", UNDEF),
                "ast": r.get("ast", UNDEF), "reason": r.get("reason", UNDEF),
                "text": r["source"]["clause"] or r["source"]["text"],
                "element": r["source"].get("element") or r["source"].get("table") or None,
                "sheet": r["source"]["sheet"], "line": r["source"]["line"],
                "elr": (m.group(1) if (m := _ELR_CODE6.search(r["source"].get("elr") or "")) else None),
            }
            for r in rules
        ],
        "exemptions": exemptions,
        "countries": countries,
        "applicableElrs": elr_sheet,
        "tableApplicability": table_applicability,
        "booleanDependencies": boolean_dependencies,
        "corpus": corpus,
    }
    coverage["booleanDependencies"] = boolean_dependencies
    return model, coverage


def _s(v) -> str:
    """JS template-literal text of a value (``${null}`` is ``"null"``)."""
    return "null" if v is None else str(v)


def _boolean_dependencies(rules: list[dict], A: dict, restricts: bool = True) -> list[dict]:
    """A dependency exists only where an executable MCA rule conditions a field or table on a non-dimensional
    boolean element ("Mandatory if Yes is selected in X", "This table is mandatory if Yes is selected in X").
    Field names are never used to invent dependencies."""

    def is_bool(q) -> bool:
        return isinstance(q, str) and (A["concepts"].get(q) or {}).get("type") == "xbrli:booleanItemType"

    def bool_cond(w):
        if not (w and w.get("op") == "cmp" and w.get("cmp") == "=="):
            return None
        l, r = w.get("l") or {}, w.get("r") or {}
        if l.get("fact") and l.get("ctx") == "nondim" and is_bool(l["fact"]) and isinstance(r.get("const", UNDEF), bool):
            return {"parent": l["fact"], "condition": r["const"]}
        return None

    deps: dict[str, dict] = {}
    for r in rules:
        a = r.get("ast")
        if r["status"] != "EXECUTABLE" or not a:
            continue
        c = None
        if a["type"] == "mandatory":
            c = bool_cond(a.get("when"))
        elif a["type"] == "eachFactOf":
            w, s = a.get("when") or {}, a.get("assert") or {}
            if (is_bool(a["concept"]) and is_nondim_only(a["concept"], A) and w.get("op") == "cmp" and (w.get("l") or {}).get("self")
                    and isinstance((w.get("r") or {}).get("const", UNDEF), bool) and s.get("op") == "entered" and (s.get("e") or {}).get("fact")):
                c = {"parent": a["concept"], "condition": w["r"]["const"], "child": s["e"]["fact"]}
        elif a["type"] == "tableRequired":
            c = bool_cond(a.get("when"))
        if not c:
            continue
        key = f"{c['parent']}|{'true' if c['condition'] else 'false'}"
        d = deps.setdefault(key, {"parentConcept": c["parent"], "condition": c["condition"], "childConcepts": [], "tables": [], "rules": []})
        if a["type"] == "tableRequired":
            d["tables"].extend(a["tables"])
            if restricts:
                a["gate"] = True  # a table that exists for a Yes answer is not available for No (shared applicability)
        else:
            d["childConcepts"].append(c.get("child") or a["concept"])
        d["rules"].append(r["id"])
    out = [
        {**d, "childConcepts": [q for q in dict.fromkeys(d["childConcepts"]) if q != d["parentConcept"]], "tables": list(dict.fromkeys(d["tables"]))}
        for d in deps.values()
    ]
    if not restricts:  # recorded for the UI; the engine's applicability does not exclude the other answer's values
        out = [{**d, "restricts": False} for d in out]
    return out
