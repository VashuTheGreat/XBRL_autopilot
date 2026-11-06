"""Internal XML validation gate. Runs BEFORE every download; blocking errors stop generation.

This is an internal pre-check only — it is NOT the official MCA XBRL Validator.
"""

from __future__ import annotations
import datetime
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from src.core import decimal as Dec
from src.core.periods import validate_periods, periods_overlap, reporting_year, scope_of
from src.core.dimensions import check_dimension_syntax, dimensionally_valid, tables_for_fact, nondim_allowed
from src.core.units import unit_def, unit_matches_type
from src.core.scaling import SCALE_POWERS
from src.core.model import Filing, fact_key
from src.core.richtext import parse_html, xml_safe
from src.core.views import total_column_allowed, nondim_row_elrs, build_elr_view, build_table_view
from .applicability import Applicability
from .rules import RuleEngine
from .expr import FORMATS
from .generator import generate_instance


class Severity:
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


ALLOWED_TAGS = {"div", "span", "p", "br", "table", "td", "tr", "thead", "tfoot", "tbody", "th"}
SCHEMA_REJECTED_TAGS = {"col", "colgroup", "caption"}
SCHEMA_REJECTED_ATTRS = {"colspan", "rowspan", "style"}
CHILDREN = {
    "table": ["thead", "tfoot", "tbody", "tr"],
    "thead": ["tr"],
    "tbody": ["tr"],
    "tfoot": ["tr"],
    "tr": ["td", "th"],
}
HTML_FIX_HINT = "open the text block (Text Block button) and click Save Text — the editor rebuilds tables and formatting in the MCA subset"

_TAG_RE = re.compile(r"<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)([^>]*)>")
_ATTR_MATCH_RE = re.compile(r"([A-Za-z_:][-\w:.]*)\s*(?:=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+))?")
_ENT_RE = re.compile(r"&[A-Za-z0-9#]+;")


def html_guideline_issues(s: Any, detail: bool = False) -> Union[List[str], Dict[str, List[str]]]:
    s_str = str(s or "")
    out: List[str] = []
    warn: List[str] = []
    if "<" not in s_str and "&" not in s_str:
        return {"errors": out, "warnings": warn} if detail else out

    for m in _TAG_RE.finditer(s_str):
        is_close = bool(m.group(1))
        name = m.group(2)
        lc = name.lower()
        if name != lc:
            out.append(f"tag <{name}> must be lower case")
        if lc in SCHEMA_REJECTED_TAGS:
            out.append(f"tag <{lc}> is rejected by the MCA Validator HTML schema")
        elif lc not in ALLOWED_TAGS:
            out.append(f"tag <{name}> is not allowed")

        if is_close:
            continue

        raw_attrs = m.group(3) or ""
        for am in _ATTR_MATCH_RE.finditer(raw_attrs):
            an = am.group(1)
            a = an.lower()
            if a == "class":
                continue
            if a == "style":
                out.append("style attribute is not allowed")
            elif a in SCHEMA_REJECTED_ATTRS:
                out.append(f"attribute '{a}' on <{lc}> is rejected by the MCA Validator HTML schema")
            elif a != "/":
                warn.append(f"attribute '{a}' on <{lc}> is not used in MCA-validated instances (only class) and may be rejected")

    if "<?" in s_str:
        out.append("processing instructions are not allowed")

    if re.search(r"<t[a-z]", s_str, re.IGNORECASE):
        def walk(n: Any):
            for c in getattr(n, "children", []):
                tag = getattr(c, "tag", None)
                if not tag or tag == "#text":
                    parent_tag = getattr(n, "tag", "")
                    if parent_tag in CHILDREN and str(getattr(c, "text", "")).strip():
                        out.append(f"text directly inside <{parent_tag}> is not allowed")
                    continue
                parent_tag = getattr(n, "tag", "")
                if parent_tag in CHILDREN and tag not in CHILDREN[parent_tag] and tag not in SCHEMA_REJECTED_TAGS:
                    expected = "/".join(CHILDREN[parent_tag])
                    out.append(f"<{tag}> inside <{parent_tag}> is not allowed (expected {expected})")
                walk(c)

        walk(parse_html(s_str))

    ents = _ENT_RE.findall(s_str)
    for e in ents:
        if e not in ("&nbsp;", "&amp;", "&lt;", "&gt;"):
            out.append(f"entity {e} is not allowed")

    unique_out = list(dict.fromkeys(out))
    unique_warn = list(dict.fromkeys(warn))
    return {"errors": unique_out, "warnings": unique_warn} if detail else unique_out


htmlGuidelineIssues = html_guideline_issues

SHARE_CAPITAL = {
    "ShareCapital",
    "ValueOfSharesAuthorised",
    "ValueOfSharesIssued",
    "ValueOfSharesSubscribed",
    "ValueOfSharesSubscribedAndFullyPaid",
    "ValueOfSharesSubscribedButNotFullyPaid",
    "ValueOfSharesCalled",
    "ValueOfSharesPaidUp",
}


def local_name(q: str) -> str:
    return q.split(":")[-1]


class GateError(Exception):
    def __init__(self, result: Dict[str, Any]):
        super().__init__(f"Internal validation gate blocked XML generation: {result.get('blocking', 0)} error(s)")
        self.result = result


class Gate:
    def __init__(self, A: Any):
        self.A = A
        self.app = Applicability(A)
        self.engine = RuleEngine(A)
        self._ops: Dict[str, Set[str]] = {}
        self._rows: Dict[str, Set[str]] = {}
        self._rules_by_id: Optional[Dict[str, Any]] = None

    def plan(self, filing: Any) -> Dict[str, List[Any]]:
        return self.app.plan_facts(filing)

    def tab_concepts(self, elr_uri: str) -> Set[str]:
        s = {q for q, c in self.A.concepts.items() if elr_uri in self.A.concept_elrs(q)}
        for t in self.A.tables_in_elr(elr_uri):
            for q in t.get("lineItems", []):
                s.add(q)
        return s

    tabConcepts = tab_concepts

    def rule_operands(self, r: Dict[str, Any]) -> Set[str]:
        r_id = r.get("id", "")
        if r_id in self._ops:
            return self._ops[r_id]
        out: Set[str] = set()

        def walk(x: Any):
            if not x:
                return
            if isinstance(x, list):
                for item in x:
                    walk(item)
                return
            if isinstance(x, dict):
                for k, v in x.items():
                    if k in ("fact", "concept") and isinstance(v, str):
                        out.add(v)
                    elif k == "concepts" and isinstance(v, list):
                        for c in v:
                            if isinstance(c, str):
                                out.add(c)
                            else:
                                walk(c)
                    elif k in ("tables", "otherTables") and isinstance(v, list):
                        for tid in v:
                            t = self.A.table(tid)
                            if t:
                                for q in t.get("lineItems", []):
                                    out.add(q)
                    elif isinstance(v, dict):
                        walk(v)

        walk(r.get("ast"))
        if r.get("subject"):
            out.add(r["subject"])
        self._ops[r_id] = out
        return out

    def locate(self, filing: Any, i: Dict[str, Any], prefer_elr: Optional[str] = None) -> Optional[Dict[str, Any]]:
        A = self.A
        code = i.get("code", "")
        general = {
            "cin.missing": "f-cin",
            "cin.format": "f-cin",
            "periods": "f-cys",
            "reportType": "f-rt",
            "schemaRef": None,
        }
        if code in general:
            return {"kind": "general", "field": general[code], "tabId": "general"}

        concept = i.get("concept")
        period = None
        dims = i.get("dims") or []
        fact = filing.facts.get(i.get("factKey")) if i.get("factKey") else None
        if fact:
            concept = fact.concept
            period = fact.period
            dims = fact.dims

        p_dict = filing.meta.get("periods", {})
        scope = reporting_year(p_dict, period) if period else (i.get("scope") or "CY")

        kind = A.concept(concept).get("kind") if concept and A.concept(concept) else None
        if kind == "hypercube" and not i.get("tableId"):
            t = next((x for x in A.tables if x.get("hypercube") == concept), None)
            if t:
                i = {**i, "tableId": t.get("id")}
            concept = None
        elif (
            kind in ("member", "explicitAxis", "typedAxis")
            or (
                A.concept(concept)
                and A.concept(concept).get("abstract")
                and any(concept in (x.get("lineItemNodes", []) + x.get("lineItems", [])) for x in A.tables)
            )
        ) and not i.get("tableId"):
            t = next(
                (
                    x
                    for x in A.tables
                    if any(ax.get("axis") == concept or any(m.get("member") == concept for m in ax.get("members", [])) for ax in x.get("axes", []))
                    or concept in (x.get("lineItemNodes", []) + x.get("lineItems", []))
                ),
                None,
            )
            if t:
                i = {**i, "tableId": t.get("id")}
            concept = None

        if not concept and i.get("tableId"):
            t = A.table(i["tableId"])
            if t:
                e = A.elr(t.get("presentationElr"))
                return {
                    "kind": "table",
                    "tabId": e.get("code") if e else None,
                    "elrUri": t.get("presentationElr"),
                    "tableId": i["tableId"],
                    "scope": scope,
                    "cellId": f"table:{i['tableId']}:{scope}",
                }

        if not concept or not A.concept(concept):
            return None

        if period and scope_of(p_dict, period) == "OTHER":
            fk = fact_key(concept, period, dims)
            return {"kind": "pyo", "tabId": None, "scope": "OTHER", "conceptQName": concept, "factKey": fk, "cellId": fk, "dims": dims}

        if period and scope_of(p_dict, period) == "PYO":
            fk = fact_key(concept, period, dims)
            cell = self._opening_cell(filing, concept, period, dims, i.get("tableId"))
            return cell or {"kind": "pyo", "tabId": None, "scope": "PY", "conceptQName": concept, "factKey": fk, "cellId": fk, "dims": dims}

        if not period:
            period = filing.period(concept, "PY" if scope == "PYO" else scope)
        if not period:
            return None

        cell_id = fact_key(concept, period, dims)
        if dims:
            axes = {d["axis"] for d in dims}
            ts = [
                t
                for t in A.tables
                if concept in t.get("lineItems", []) and all(any(x.get("axis") == d["axis"] for x in t.get("axes", [])) for d in dims)
            ]
            t = (
                (A.table(i.get("tableId")) if i.get("tableId") else None)
                or next((x for x in ts if len(x.get("axes", [])) == len(axes)), None)
                or (ts[0] if ts else None)
            )
            if t:
                e = A.elr(t.get("presentationElr"))
                return {
                    "kind": "cell",
                    "tabId": e.get("code") if e else None,
                    "elrUri": t.get("presentationElr"),
                    "tableId": t.get("id"),
                    "scope": "PY" if scope == "PYO" else scope,
                    "conceptQName": concept,
                    "rowId": concept,
                    "cellId": cell_id,
                    "dims": dims,
                }

        row_elrs = nondim_row_elrs(A).get(concept, set())
        rule_code = self._rule_elr(i.get("ruleId")) if i.get("ruleId") else None

        def in_rule(u: str) -> bool:
            e = A.elr(u)
            return bool(rule_code and e and (e.get("code") or "").startswith(rule_code))

        tot = [t for t in A.tables if concept in t.get("lineItems", []) and total_column_allowed(A, t.get("id"))]
        t_tot = (
            (A.table(i.get("tableId")) if i.get("tableId") else None)
            or next((x for x in tot if x.get("presentationElr") == prefer_elr and x.get("presentationElr") not in row_elrs), None)
            or next((x for x in tot if in_rule(x.get("presentationElr")) and not any(in_rule(u) for u in row_elrs)), None)
            or (tot[0] if not row_elrs and tot else None)
        )
        if t_tot:
            e = A.elr(t_tot.get("presentationElr"))
            return {
                "kind": "cell",
                "tabId": e.get("code") if e else None,
                "elrUri": t_tot.get("presentationElr"),
                "tableId": t_tot.get("id"),
                "scope": "PY" if scope == "PYO" else scope,
                "conceptQName": concept,
                "rowId": concept,
                "cellId": cell_id,
                "dims": [],
            }

        if not row_elrs and not nondim_allowed(A, concept):
            t = (
                (A.table(i.get("tableId")) if i.get("tableId") else None)
                or next((x for x in A.tables if concept in x.get("lineItems", []) and (in_rule(x.get("presentationElr")) or x.get("presentationElr") == prefer_elr)), None)
                or next((x for x in A.tables if concept in x.get("lineItems", [])), None)
            )
            if t:
                e = A.elr(t.get("presentationElr"))
                return {
                    "kind": "table",
                    "tabId": e.get("code") if e else None,
                    "elrUri": t.get("presentationElr"),
                    "tableId": t.get("id"),
                    "scope": "PY" if scope == "PYO" else scope,
                    "cellId": f"table:{t.get('id')}:{'PY' if scope == 'PYO' else scope}",
                }

        elrs = [u for u in A.concept_elrs(concept) if u in row_elrs]
        sc = "PY" if scope == "PYO" else scope
        rule_elr_obj = A.elr_by_code(rule_code) if rule_code else None
        rule_elr = rule_elr_obj.get("uri") if rule_elr_obj else None

        def ok(u: str) -> bool:
            return self.app.cell_status(filing, u, concept, sc)["applicable"]

        elr_uri = next((u for u in (prefer_elr, rule_elr) if u and u in elrs and ok(u)), None) or next((u for u in elrs if ok(u)), None) or (elrs[0] if elrs else None)

        if elr_uri and not self._item_row(elr_uri, concept):
            t = next((x for x in A.tables_in_elr(elr_uri) if not x.get("axes") and concept in x.get("lineItems", [])), None)
            if t:
                e = A.elr(elr_uri)
                return {
                    "kind": "cell",
                    "tabId": e.get("code") if e else None,
                    "elrUri": elr_uri,
                    "tableId": t.get("id"),
                    "scope": sc,
                    "conceptQName": concept,
                    "rowId": concept,
                    "cellId": cell_id,
                    "dims": [],
                }

        e = A.elr(elr_uri) if elr_uri else None
        return {
            "kind": "cell",
            "tabId": e.get("code") if e else None,
            "elrUri": elr_uri,
            "tableId": None,
            "scope": sc,
            "conceptQName": concept,
            "rowId": concept,
            "cellId": cell_id,
            "dims": [],
        }

    def _opening_cell(self, filing: Any, concept: str, period: Dict[str, Any], dims: List[Dict[str, Any]], table_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        A = self.A
        cell_id = fact_key(concept, period, dims)
        if not dims:
            for e in A.elrs:
                r_item = next(
                    (
                        x
                        for x in build_elr_view(A, e.get("uri")).get("rows", [])
                        if x.get("kind") == "item"
                        and x.get("concept") == concept
                        and x.get("preferredLabel") == "periodStartLabel"
                    ),
                    None,
                )
                if r_item and self.app.cell_status(filing, e.get("uri"), concept, "PY")["applicable"]:
                    return {
                        "kind": "cell",
                        "tabId": e.get("code"),
                        "elrUri": e.get("uri"),
                        "tableId": None,
                        "scope": "PY",
                        "conceptQName": concept,
                        "rowId": concept,
                        "cellId": cell_id,
                        "dims": [],
                    }

        ts = (
            tables_for_fact(A, {"concept": concept, "dims": dims})
            if dims
            else [
                t
                for t in A.tables
                if concept in t.get("lineItems", [])
                and t.get("axes")
                and total_column_allowed(A, t.get("id"))
                and nondim_allowed(A, concept)
            ]
        )
        sorted_ts = [t for t in ts if t.get("id") == table_id] + [t for t in ts if t.get("id") != table_id] if table_id else ts
        for t in sorted_ts:
            tb_view = build_table_view(A, t.get("id"))
            if not any(l.get("concept") == concept and l.get("preferredLabel") == "periodStartLabel" for l in tb_view.get("lineItems", [])):
                continue
            if not self.app.table_status(filing, t.get("id"), "PY")["applicable"]:
                continue
            e = A.elr(t.get("presentationElr"))
            return {
                "kind": "cell",
                "tabId": e.get("code") if e else None,
                "elrUri": t.get("presentationElr"),
                "tableId": t.get("id"),
                "scope": "PY",
                "conceptQName": concept,
                "rowId": concept,
                "cellId": cell_id,
                "dims": dims,
                "opening": True,
            }
        return None

    def _item_row(self, elr_uri: str, concept: str) -> bool:
        if elr_uri not in self._rows:
            view = build_elr_view(self.A, elr_uri)
            self._rows[elr_uri] = {r["concept"] for r in view.get("rows", []) if r.get("kind") == "item"}
        return concept in self._rows[elr_uri]

    def checked(self, loc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not loc or loc.get("kind") != "cell" or not loc.get("conceptQName"):
            return loc
        A = self.A
        q = loc["conceptQName"]
        if loc.get("tableId"):
            t = A.table(loc["tableId"])
            if loc.get("dims"):
                valid = dimensionally_valid(A, q, loc["dims"]).get("valid")
            else:
                valid = (total_column_allowed(A, t.get("id")) if t.get("axes") else True) and nondim_allowed(A, q)
            if valid:
                return loc
            return {
                "kind": "table",
                "tabId": loc.get("tabId"),
                "elrUri": loc.get("elrUri"),
                "tableId": loc.get("tableId"),
                "scope": loc.get("scope"),
                "cellId": f"table:{loc.get('tableId')}:{loc.get('scope')}",
            }
        if loc.get("elrUri") and self._item_row(loc["elrUri"], q):
            return loc
        if loc.get("elrUri"):
            return {"kind": "tab", "tabId": loc.get("tabId"), "elrUri": loc.get("elrUri"), "scope": loc.get("scope")}
        return None

    def _rule_elr(self, r_id: str) -> Optional[str]:
        if self._rules_by_id is None:
            self._rules_by_id = {x["id"]: x for x in self.A.rules.get("rules", [])}
        r = self._rules_by_id.get(r_id)
        return r.get("elr") if r else None

    def run(self, filing: Any, today: Optional[str] = None, tab: Optional[str] = None) -> Dict[str, Any]:
        A = self.A
        issues: List[Dict[str, Any]] = []

        def add(severity: str, code: str, message: str, extra: Optional[Dict[str, Any]] = None):
            issues.append({"severity": severity, "code": code, "message": message, **(extra or {})})

        p_dict = filing.meta.get("periods", {})
        in_tab = self.tab_concepts(tab) if tab else None

        def tab_fact(f: Any) -> bool:
            return not in_tab or f.concept in in_tab

        # Document level
        if not tab:
            sref = filing.meta.get("schemaRef") or A.meta.get("schemaRef")
            accepted_refs = [x.get("href") for x in (A.meta.get("acceptedSchemaRefs") or [{"href": A.meta.get("schemaRef")}])]
            if sref not in accepted_refs:
                add("ERROR", "schemaRef", f"schemaRef '{sref}' is not an accepted C&I 2016 entry point")
            cin_val = filing.meta.get("cin", "")
            if not cin_val:
                add("ERROR", "cin.missing", "CIN (entity identifier) is required")
            elif not FORMATS["CIN"].match(cin_val):
                add("ERROR", "cin.format", f"CIN '{cin_val}' is not a valid 21-character CIN")
            for e in validate_periods(p_dict):
                if not (filing.meta.get("firstFinancialYear") and e.startswith("PY")):
                    add("ERROR", "periods", e)
            if filing.meta.get("reportType") not in ("Standalone", "Consolidated"):
                add("ERROR", "reportType", "Nature of report must be Standalone or Consolidated")

        planned = self.plan(filing)
        emit = planned["emit"]
        excluded = planned["excluded"]

        for x in excluded:
            f = x["fact"]
            if tab_fact(f):
                dim_str = " (dimensional)" if f.dims else ""
                per_str = f.period.get("date") if f.period.get("type") == "instant" else f"{f.period.get('start')}…{f.period.get('end')}"
                reasons_str = "; ".join(x.get("reasons", []))
                add("WARNING", "excluded", f"Not applicable — excluded from XML: {f.concept}{dim_str} {per_str}: {reasons_str}", {"factKey": f.key})

        eff = Filing(A, filing.meta)
        for f in emit:
            eff.facts[f.key] = f
        eff.footnotes = filing.footnotes

        # Fact level
        by_concept: Dict[str, List[Any]] = {}
        for f in emit:
            if not tab_fact(f):
                continue
            c = A.concept(f.concept)
            dims_str = f" [{', '.join((d.get('member') or str(d.get('typed'))) for d in f.dims)}]" if f.dims else ""
            per_str = f.period.get("date") if f.period.get("type") == "instant" else f"{f.period.get('start')}…{f.period.get('end')}"
            where = f"{f.concept}{dims_str} @ {per_str}"

            if not c or not A.is_reportable(f.concept):
                add("ERROR", "concept.unknown", f"Unknown/non-reportable concept {f.concept}", {"factKey": f.key})
                continue

            expected_type = "instant" if f.period.get("type") == "instant" else "duration"
            if c.get("periodType") != expected_type:
                add("ERROR", "period.type", f"{where}: period type must be {c.get('periodType')}", {"factKey": f.key})

            y = reporting_year(p_dict, f.period)
            if y == "OTHER":
                add("ERROR", "period.unmapped", f"{where}: period is neither current nor previous reporting period", {"factKey": f.key})

            if f.nil and not c.get("nillable"):
                add("ERROR", "nil", f"{where}: concept is not nillable", {"factKey": f.key})

            if not f.nil:
                try:
                    if filing.canonical_value(f.concept, f.value) != f.value and A.is_numeric(f.concept):
                        add("ERROR", "value.canonical", f"{where}: value not canonical", {"factKey": f.key})
                except Exception as e:
                    add("ERROR", "value.type", f"{where}: {e}", {"factKey": f.key})

                facets = A.type_facets(f.concept)
                if facets and facets.get("pattern"):
                    pat = re.compile(f"^(?:{facets['pattern']})$")
                    if not pat.match(str(f.value)):
                        add("ERROR", "value.pattern", f"{where}: '{f.value}' does not match {c.get('type')} pattern", {"factKey": f.key})

                if facets and facets.get("length"):
                    if len(str(f.value)) != int(facets["length"]):
                        add("ERROR", "value.length", f"{where}: length must be {facets['length']} ({c.get('type')})", {"factKey": f.key})

                if isinstance(f.value, str) and xml_safe(f.value) != f.value:
                    add("ERROR", "value.xmlChar", f"{where}: contains control characters XML does not allow — the MCA Validator rejects the whole file.", {"factKey": f.key})

                dt = A.data_type(f.concept)
                if dt in ("textBlock", "string"):
                    hd = html_guideline_issues(f.value, detail=True)
                    ent = [x for x in hd["errors"] if x.startswith("entity")]
                    other = [x for x in hd["errors"] if not x.startswith("entity")]
                    if other:
                        add("ERROR", "html", f"{where}: HTML guidelines — {'; '.join(other)}. To fix: {HTML_FIX_HINT}.", {"factKey": f.key})
                    if ent or hd["warnings"]:
                        add("WARNING", "html.entity", f"{where}: HTML guidelines — {'; '.join(ent + hd['warnings'])}", {"factKey": f.key})

            if A.is_numeric(f.concept):
                u = unit_def(f.unit) if f.unit else None
                if not u:
                    add("ERROR", "unit.missing", f"{where}: numeric fact requires a unit", {"factKey": f.key})
                elif not unit_matches_type(A.data_type(f.concept), u):
                    add("ERROR", "unit.type", f"{where}: unit {f.unit} does not match {A.data_type(f.concept)}", {"factKey": f.key})

                if not f.nil:
                    if f.decimals is None or not (f.decimals == "INF" or re.match(r"^-?\d+$", str(f.decimals))):
                        add("ERROR", "decimals", f"{where}: decimals attribute required (precision is prohibited)", {"factKey": f.key})
                    elif not Dec.eq(Dec.round_dec(Dec.parse(f.value), f.decimals), Dec.parse(f.value)):
                        add("ERROR", "decimals.nonSignificant", f"{where}: non-significant digits must be 0 for decimals={f.decimals} (Filing Manual #13)", {"factKey": f.key})
                    elif (
                        local_name(f.concept) in SHARE_CAPITAL
                        and f.origin != "calculated"
                        and f.decimals != "INF"
                        and int(f.decimals) < 0
                        and not Dec.eq(Dec.parse(f.value), Dec.ZERO)
                        and y == "CY"
                    ):
                        step = f"₹{10 ** (-int(f.decimals)):,}"
                        add("WARNING", "shareCapital.rounded", f"{where}: share capital is reported accurate only to {step} (decimals {f.decimals}). Type it to the exact rupee.", {"factKey": f.key})
            elif not f.nil and A.lang_allowed(f.concept) and f.lang != "en":
                add("INFO", "lang", f"{where}: textual facts should carry xml:lang=\"en\" — will be emitted as 'en'", {"factKey": f.key})

            for e in check_dimension_syntax(A, f.dims):
                add("ERROR", e["code"], f"{where}: {e['msg']}", {"factKey": f.key})

            dv = dimensionally_valid(A, f.concept, f.dims)
            if not dv.get("valid"):
                add("ERROR", "dim.hypercube", f"{where}: dimensionally invalid — {dv.get('reason')}", {"factKey": f.key})

            by_concept.setdefault(f.concept, []).append(f)

        # Overlapping periods
        for q, lst in by_concept.items():
            for i in range(len(lst)):
                for j in range(i + 1, len(lst)):
                    a_fact = lst[i]
                    b_fact = lst[j]
                    if len(a_fact.dims) == len(b_fact.dims) and a_fact.dims == b_fact.dims:
                        if periods_overlap(a_fact.period, b_fact.period):
                            add("ERROR", "period.overlap", f"{q}: overlapping periods (Filing Manual #9)", {"factKey": a_fact.key})

        ir = filing.import_report
        if ir and not tab:
            for e in ir.get("errors", []):
                add("ERROR", "import", e)
            for u in ir.get("unresolvedFacts", []):
                add("WARNING", "import.unresolved", f"Unresolved source fact {u.get('element')} ({u.get('contextRef')}): {u.get('reason')}")
            for c in ir.get("conflicts", []):
                add("ERROR", "import.conflict", f"Inconsistent duplicate facts for {c.get('concept')} in {c.get('contextRef')}")

        # Business rules
        only_rules = None
        if tab:
            only_rules = set()
            for r in A.rules.get("rules", []):
                if r.get("status") not in ("EXECUTABLE", "UNIMPLEMENTED"):
                    continue
                if r.get("family") == "generic" or any(q in in_tab for q in self.rule_operands(r)):
                    only_rules.add(r.get("id"))

        br = self.engine.run(eff, today=today, only=only_rules)
        rule_by_id = {r["id"]: r for r in A.rules.get("rules", [])}

        for r_res in br["results"]:
            loc_data: Dict[str, Any] = {
                "ruleId": r_res.get("ruleId"),
                "scope": r_res.get("scope"),
                "factKey": r_res.get("factKey"),
                "concept": r_res.get("concept"),
                "dims": r_res.get("dims"),
                "tableId": r_res.get("tableId"),
            }
            if r_res.get("calc"):
                loc_data["calc"] = True
            if r_res.get("locateMissing"):
                loc_data["locateMissing"] = r_res["locateMissing"]

            if tab:
                r_def = rule_by_id.get(r_res.get("ruleId", ""))
                ops = self.rule_operands(r_def) if r_def else set()
                if r_def and r_def.get("family") == "generic" and r_res.get("status") != "PASS":
                    l = self.locate(eff, {**loc_data, "code": "rule"}, tab)
                    if not l or l.get("elrUri") != tab:
                        continue
                if ops and any(q not in in_tab for q in ops):
                    loc_data["crossTab"] = True

            st = r_res.get("status")
            rid = r_res.get("ruleId")
            msg = r_res.get("message")
            if st == "FAIL":
                add("ERROR", f"rule.{rid}", f"[{rid}] {msg}", loc_data)
            elif st == "WARN":
                add("WARNING", f"rule.{rid}", f"[{rid}] {msg}", loc_data)
            elif st == "REVIEW_ONLY_EXTERNAL_DATA":
                add("INFO", f"review.{rid}", f"[{rid}] review manually (needs data outside the instance): {msg}", {"ruleId": rid})
            elif st == "UNIMPLEMENTED":
                add("WARNING", f"unimplemented.{rid}", f"[{rid}] not executed (known limitation): {msg}", {"ruleId": rid})
            elif st == "APPROVED_LIMITATION_NOT_EXECUTED":
                add("WARNING", f"limitation.{rid}", f"[{rid}] {msg} — not an MCA validation result", {"ruleId": rid})

        if not emit and not tab:
            add("ERROR", "empty", "No facts to generate")

        for iss in issues:
            locate_dict = iss
            if iss.get("locateMissing"):
                locate_dict = {
                    **iss,
                    "factKey": None,
                    "concept": iss["locateMissing"].get("concept"),
                    "scope": iss["locateMissing"].get("scope"),
                    "dims": [],
                }
            iss["location"] = self.checked(self.locate(filing, locate_dict, tab))

        errors = [i for i in issues if i["severity"] == "ERROR"]
        warnings = [i for i in issues if i["severity"] == "WARNING"]
        infos = [i for i in issues if i["severity"] == "INFO"]

        tab_elr = A.elr(tab) if tab else None
        return {
            "ok": len(errors) == 0,
            "blocking": len(errors),
            "issues": issues,
            "summary": {
                "errors": len(errors),
                "warnings": len(warnings),
                "info": len(infos),
                "facts": len(emit),
                "excluded": len(excluded),
            },
            "ruleResults": br["results"],
            "ruleStatus": br["ruleStatus"],
            "calculations": br["calculations"],
            "emit": emit,
            "scope": {
                "kind": "tab",
                "elrUri": tab,
                "code": tab_elr.get("code") if tab_elr else None,
                "rulesRun": len(only_rules) if only_rules else 0,
            } if tab else {"kind": "filing"},
            "officialValidation": "NOT_RUN",
        }


def export_xml(A: Any, filing: Any, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    opts = opts or {}
    gate_res = Gate(A).run(filing, today=opts.get("today"), tab=opts.get("tab"))
    if not gate_res["ok"] and not opts.get("allowErrors"):
        raise GateError(gate_res)

    emit_facts = []
    for f in gate_res["emit"]:
        if A.is_numeric(f.concept):
            emit_facts.append(f)
        elif A.lang_allowed(f.concept):
            if not f.nil and not f.lang:
                fact_copy = Fact(
                    key=f.key,
                    concept=f.concept,
                    period=f.period,
                    dims=f.dims,
                    value=f.value,
                    nil=f.nil,
                    decimals=f.decimals,
                    unit=f.unit,
                    lang="en",
                    origin=f.origin,
                    source=f.source,
                    source_id=f.source_id,
                )
                emit_facts.append(fact_copy)
            else:
                emit_facts.append(f)
        else:
            if f.lang:
                fact_copy = Fact(
                    key=f.key,
                    concept=f.concept,
                    period=f.period,
                    dims=f.dims,
                    value=f.value,
                    nil=f.nil,
                    decimals=f.decimals,
                    unit=f.unit,
                    lang=None,
                    origin=f.origin,
                    source=f.source,
                    source_id=f.source_id,
                )
                emit_facts.append(fact_copy)
            else:
                emit_facts.append(f)

    gen = generate_instance(A, filing, emit_facts)
    xml_str = gen["xml"]
    if not gate_res["ok"]:
        err_count = gate_res["summary"]["errors"]
        comment = f"<!-- NOT VALIDATED: generated with {err_count} unresolved internal validation error(s), for review only (e.g. the MCA validator's PDF). Do not file. -->"
        xml_str = re.sub(r"^(<\?xml[^>]*\?>)", rf"\1\n{comment}", xml_str)

    return {"xml": xml_str, "gate": gate_res, "validated": gate_res["ok"]}


exportXml = export_xml
