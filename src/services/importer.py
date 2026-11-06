"""XBRL instance importer.

Every source fact either maps to a canonical internal fact or is listed in the
unresolved-import report; nothing disappears silently.
"""

from __future__ import annotations
import calendar
import datetime
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from src.core import decimal as Dec
from src.core.authority import Authority
from src.core.model import Filing, FactValueError, norm_dims, dim_key
from src.core.periods import period_key, iso_date, scope_of, add_days
from src.core.scaling import SCALE_POWERS
from src.core.units import unit_def
from src.engine.applicability import Applicability, opening_concepts

NS = {
    "xbrli": "http://www.xbrl.org/2003/instance",
    "link": "http://www.xbrl.org/2003/linkbase",
    "xlink": "http://www.w3.org/1999/xlink",
    "xbrldi": "http://xbrl.org/2006/xbrldi",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "iso4217": "http://www.xbrl.org/2003/iso4217",
}


class CashFlowChoiceError(Exception):
    def __init__(self, cash_flow: Dict[str, Any]):
        super().__init__("Cash flow method ambiguous")
        self.cash_flow = cash_flow


def same_day_next_year(iso: str) -> str:
    s = iso.strip()[:10]
    y, m, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
    ny = y + 1
    _, max_d = calendar.monthrange(ny, m)
    return f"{ny:04d}-{m:02d}-{min(d, max_d):02d}"


def detect_cash_flow(A: Authority, filing: Filing, scope: Optional[str] = "CY") -> Optional[Dict[str, Any]]:
    q_type = A.qname_of_local("TypeOfCashFlowStatement")
    declared = filing.value(q_type, scope, []) if (q_type and scope) else None

    # concepts in 100300 (Direct) vs 100400 (Indirect)
    direct_elr = next((e for e in A.elrs if (e.get("code") or "").startswith("100300")), None)
    indirect_elr = next((e for e in A.elrs if (e.get("code") or "").startswith("100400")), None)

    direct_uri = direct_elr.get("uri") if direct_elr else None
    indirect_uri = indirect_elr.get("uri") if indirect_elr else None

    direct_count = 0
    indirect_count = 0

    for f in filing.all():
        if f.nil:
            continue
        elrs = A.concept_elrs(f.concept)
        if direct_uri in elrs and indirect_uri not in elrs:
            direct_count += 1
        elif indirect_uri in elrs and direct_uri not in elrs:
            indirect_count += 1

    detected = None
    if direct_count > 0 and indirect_count == 0:
        detected = "Direct Method"
    elif indirect_count > 0 and direct_count == 0:
        detected = "Indirect Method"

    ambiguous = (direct_count > 0 and indirect_count > 0) or (direct_count == 0 and indirect_count == 0 and not declared)

    return {
        "declared": declared,
        "detected": detected,
        "directCount": direct_count,
        "indirectCount": indirect_count,
        "ambiguous": ambiguous,
    }


def split_tag(tag: str) -> Tuple[Optional[str], str]:
    if tag.startswith("{"):
        ns, _, local = tag[1:].partition("}")
        return ns, local
    return None, tag


def import_instance(
    A: Authority,
    xml_text: str,
    file_name: str = "instance.xml",
    year_mode: str = "both",
    cash_flow_method: Optional[str] = None,
) -> Dict[str, Any]:
    if year_mode not in ("both", "current", "next"):
        raise ValueError(f"Unknown import year mode {year_mode}")

    report: Dict[str, Any] = {
        "fileName": file_name,
        "schemaRef": None,
        "schemaRefMatches": False,
        "errors": [],
        "warnings": [],
        "contexts": [],
        "units": [],
        "unknownConcepts": [],
        "unresolvedFacts": [],
        "duplicates": [],
        "conflicts": [],
        "periodDetection": None,
        "yearMode": year_mode,
        "counts": {"sourceFacts": 0, "imported": 0, "unresolved": 0, "footnotes": 0},
        "byYear": {
            "current": 0,
            "previous": 0,
            "previousOpening": 0,
            "other": 0,
            "skippedPrevious": 0,
            "skippedPreviousOpening": 0,
            "carriedOpening": 0,
            "cyOpeningAtPyEnd": 0,
        },
        "carriedOpeningConcepts": [],
        "cashFlow": None,
        "notApplicable": [],
    }

    try:
        root = ET.fromstring(xml_text)
    except (ET.ParseError, ValueError, Exception) as e:
        raise ValueError(f"Not well-formed XML: {e}") from e

    ns, local = split_tag(root.tag)
    if ns != NS["xbrli"] or local != "xbrl":
        raise ValueError("Root element is not xbrli:xbrl")

    ns_to_prefix = {v: k for k, v in A.namespaces.items()}

    # schemaRef
    sr_el = None
    for child in root:
        c_ns, c_local = split_tag(child.tag)
        if c_ns == NS["link"] and c_local == "schemaRef":
            sr_el = child
            break

    schema_href = None
    if sr_el is not None:
        schema_href = sr_el.attrib.get(f"{{{NS['xlink']}}}href") or sr_el.attrib.get("xlink:href") or sr_el.attrib.get("href")

    report["schemaRef"] = schema_href
    accepted = [x.get("href") for x in (A.meta.get("acceptedSchemaRefs") or [{"href": A.meta.get("schemaRef")}])]
    report["schemaRefMatches"] = schema_href in accepted

    if not report["schemaRefMatches"]:
        retired = A.meta.get("retiredSchemaRefs") or []
        if schema_href in retired:
            report["warnings"].append(
                f"schemaRef '{schema_href}' is the old V2 address; export will use '{A.meta.get('schemaRef')}'"
            )
        else:
            report["warnings"].append(
                f"schemaRef '{schema_href}' is not an accepted C&I 2016 entry point; export will use '{A.meta.get('schemaRef')}'"
            )

    # Contexts
    contexts: Dict[str, Dict[str, Any]] = {}
    cins: Set[str] = set()

    for child in root:
        c_ns, c_local = split_tag(child.tag)
        if c_ns != NS["xbrli"] or c_local != "context":
            continue
        c_id = child.attrib.get("id")
        ent_el = next((c for c in child if split_tag(c.tag) == (NS["xbrli"], "entity")), None)
        ident_el = next((c for c in ent_el if split_tag(c.tag) == (NS["xbrli"], "identifier")), None) if ent_el is not None else None
        if ident_el is not None:
            cins.add((ident_el.text or "").strip())
            scheme = ident_el.attrib.get("scheme")
            if scheme != A.meta.get("cinScheme"):
                report["warnings"].append(f"Context {c_id}: identifier scheme '{scheme}' is not {A.meta.get('cinScheme')}")

        per_el = next((c for c in child if split_tag(c.tag) == (NS["xbrli"], "period")), None)
        period: Optional[Dict[str, str]] = None
        if per_el is not None:
            inst = next((c for c in per_el if split_tag(c.tag) == (NS["xbrli"], "instant")), None)
            if inst is not None and inst.text:
                period = {"type": "instant", "date": inst.text.strip()[:10]}
            else:
                sd = next((c for c in per_el if split_tag(c.tag) == (NS["xbrli"], "startDate")), None)
                ed = next((c for c in per_el if split_tag(c.tag) == (NS["xbrli"], "endDate")), None)
                if sd is not None and ed is not None and sd.text and ed.text:
                    period = {"type": "duration", "start": sd.text.strip()[:10], "end": ed.text.strip()[:10]}

        if not period:
            report["errors"].append(f"Context {c_id}: unsupported period")
            continue

        dims = []
        issues = []
        scen_el = next((c for c in child if split_tag(c.tag) == (NS["xbrli"], "scenario")), None)
        seg_el = next((c for c in ent_el if split_tag(c.tag) == (NS["xbrli"], "segment")), None) if ent_el is not None else None
        if seg_el is not None:
            issues.append("segment element present (Filing Manual #32: not allowed) — dimensions read from it")

        holders = [h for h in (scen_el, seg_el) if h is not None]
        for h in holders:
            for mem_el in h:
                m_ns, m_loc = split_tag(mem_el.tag)
                dq = mem_el.attrib.get("dimension")
                if not dq:
                    continue
                # resolve QName
                axis = None
                if ":" in dq:
                    # check namespace in elem if needed
                    axis = dq  # e.g. in-gaap:BorrowingsAxis
                else:
                    axis = dq

                if not A.concept(axis):
                    issues.append(f"unknown dimension {dq}")
                    continue

                if m_loc == "explicitMember":
                    mem_q = (mem_el.text or "").strip()
                    if not A.concept(mem_q):
                        issues.append(f"unknown member {mem_q}")
                        continue
                    dims.append({"axis": axis, "member": mem_q})
                elif m_loc == "typedMember":
                    val_el = list(mem_el)[0] if len(mem_el) else None
                    typed_text = (val_el.text or "").strip() if val_el is not None else ""
                    dims.append({"axis": axis, "typed": typed_text})

        nd = norm_dims(dims)
        p_key = period_key(period)
        d_key = dim_key(nd)
        contexts[c_id] = {
            "id": c_id,
            "period": period,
            "dims": nd,
            "internalKey": f"{p_key}#{d_key}",
            "issues": issues,
        }
        report["contexts"].append({"sourceContextId": c_id, "internalContextKey": f"{p_key}#{d_key}", "issues": issues})

    # Units
    units: Dict[str, Dict[str, Any]] = {}
    for child in root:
        c_ns, c_local = split_tag(child.tag)
        if c_ns != NS["xbrli"] or c_local != "unit":
            continue
        u_id = child.attrib.get("id")
        div_el = next((c for c in child if split_tag(c.tag) == (NS["xbrli"], "divide")), None)
        if div_el is not None:
            num_el = next((c for c in div_el if split_tag(c.tag) == (NS["xbrli"], "unitNumerator")), None)
            den_el = next((c for c in div_el if split_tag(c.tag) == (NS["xbrli"], "unitDenominator")), None)
            nums = [(m.text or "").strip() for m in (num_el if num_el is not None else []) if split_tag(m.tag) == (NS["xbrli"], "measure")]
            dens = [(m.text or "").strip() for m in (den_el if den_el is not None else []) if split_tag(m.tag) == (NS["xbrli"], "measure")]
            u_def = {"id": u_id, "numerator": nums, "denominator": dens}
        else:
            measures = [(m.text or "").strip() for m in child if split_tag(m.tag) == (NS["xbrli"], "measure")]
            u_def = {"id": u_id, "measures": measures}
        units[u_id] = u_def
        report["units"].append(u_def)

    def unit_internal(defn: Optional[Dict[str, Any]]) -> Optional[str]:
        if not defn:
            return None
        if "denominator" in defn:
            num0 = defn.get("numerator", [""])[0]
            den0 = defn.get("denominator", [""])[0]
            if (num0.endswith("INR") or "INR" in num0) and (den0.endswith("shares") or "shares" in den0):
                return "INRPerShare"
            curr = num0.split(":")[-1]
            return f"{curr}PerShare"
        meas = defn.get("measures", [""])[0]
        if meas.endswith("shares") or "shares" in meas:
            return "shares"
        if meas.endswith("pure") or "pure" in meas:
            return "pure"
        if "iso4217:" in meas:
            return meas.split(":")[-1]
        return None

    # Facts
    raw_facts = []
    for child in root:
        c_ns, c_local = split_tag(child.tag)
        if c_ns in (NS["xbrli"], NS["link"]):
            continue
        report["counts"]["sourceFacts"] += 1
        prefix = ns_to_prefix.get(c_ns)
        concept = f"{prefix}:{c_local}" if prefix else None
        nil_val = (
            child.attrib.get(f"{{{NS['xsi']}}}nil") == "true"
            or child.attrib.get("xsi:nil") == "true"
        )
        src = {
            "element": f"{{{c_ns}}}{c_local}",
            "contextRef": child.attrib.get("contextRef"),
            "unitRef": child.attrib.get("unitRef"),
            "decimals": child.attrib.get("decimals"),
            "precision": child.attrib.get("precision"),
            "lang": child.attrib.get("{http://www.w3.org/XML/1998/namespace}lang") or child.attrib.get("xml:lang"),
            "id": child.attrib.get("id"),
            "nil": nil_val,
            "value": child.text or "",
        }
        if not concept or not A.concept(concept):
            report["unknownConcepts"].append(src["element"])
            report["unresolvedFacts"].append({**src, "reason": "Unknown concept (not in the C&I 2016 taxonomy)"})
            continue

        ctx = contexts.get(src["contextRef"])
        if not ctx:
            report["unresolvedFacts"].append({**src, "concept": concept, "reason": f"contextRef '{src['contextRef']}' not defined"})
            continue
        if src["precision"]:
            report["errors"].append(f"Fact {concept} in {src['contextRef']} uses precision (prohibited)")

        raw_facts.append({"concept": concept, "ctx": ctx, "src": src})

    # Periods detection
    q_start = A.qname_of_local("DateOfStartOfReportingPeriod")
    q_end = A.qname_of_local("DateOfEndOfReportingPeriod")
    by_ctx: Dict[str, Dict[str, Any]] = {}
    for f in raw_facts:
        if f["concept"] in (q_start, q_end):
            entry = by_ctx.setdefault(f["ctx"]["id"], {"ctx": f["ctx"]})
            entry["start" if f["concept"] == q_start else "end"] = f["src"]["value"].strip()

    pairs = [e for e in by_ctx.values() if iso_date(e.get("start")) and iso_date(e.get("end"))]
    method = "DateOfStartOfReportingPeriod/DateOfEndOfReportingPeriod facts"
    if not pairs:
        dur_contexts = [c for c in contexts.values() if c["period"]["type"] == "duration"]
        pairs = [{"start": c["period"]["start"], "end": c["period"]["end"]} for c in dur_contexts]
        method = "duration contexts"

    unique_pairs = []
    seen_pairs: Set[str] = set()
    for p in pairs:
        k = f"{p['start']}#{p['end']}"
        if k not in seen_pairs:
            seen_pairs.add(k)
            unique_pairs.append({"start": p["start"], "end": p["end"]})
    unique_pairs.sort(key=lambda x: x["end"], reverse=True)

    cy = unique_pairs[0] if unique_pairs else {"start": "", "end": ""}
    py = next((p for p in unique_pairs if p["end"] < cy["start"]), {"start": "", "end": ""})
    report["periodDetection"] = {"method": method, "cy": cy, "py": py, "candidates": unique_pairs}
    if not py.get("end"):
        report["warnings"].append("No previous-year period detected")

    cin_val = list(cins)[0] if cins else ""
    filing = Filing(
        A,
        {
            "name": file_name.replace(".xml", "").replace(".XML", ""),
            "cin": cin_val,
            "periods": {"cy": cy, "py": py},
            "firstFinancialYear": not bool(py.get("end")),
            "schemaRef": report["schemaRef"] if report["schemaRefMatches"] else A.meta.get("schemaRef"),
        },
    )
    if len(cins) > 1:
        report["errors"].append(f"Contexts use different CINs: {', '.join(cins)}")

    # Materialize facts
    skipped_ids: Set[str] = set()
    set_aside: List[Dict[str, Any]] = []

    def year_of(period: Dict[str, Any]) -> str:
        return scope_of({"cy": cy, "py": py}, period) or "OTHER"

    facts_by_id: Dict[str, str] = {}
    for item in raw_facts:
        concept = item["concept"]
        ctx = item["ctx"]
        src = item["src"]
        y = year_of(ctx["period"]) if (py.get("end") or cy.get("end")) else "CY"
        is_cy_opening = y == "PY" and ctx["period"]["type"] == "instant" and concept in opening_concepts(A)
        if is_cy_opening:
            report["byYear"]["cyOpeningAtPyEnd"] += 1
        carry = year_mode == "current" and is_cy_opening

        if (year_mode in ("current", "next")) and y in ("PY", "PYO") and not carry:
            report["byYear"]["skippedPrevious" if y == "PY" else "skippedPreviousOpening"] += 1
            if src.get("id"):
                skipped_ids.add(src["id"])
            if year_mode == "next":
                set_aside.append({
                    "concept": concept,
                    "period": ctx["period"],
                    "dims": ctx["dims"],
                    "value": None if src["nil"] else src["value"],
                    "nil": bool(src["nil"]),
                    "decimals": src.get("decimals"),
                    "unitRef": src.get("unitRef"),
                    "lang": src.get("lang"),
                    "reason": "yearBeforeLast" if y == "PY" else "openingBeforeLast",
                })
            continue

        u_def = units.get(src["unitRef"]) if src.get("unitRef") else None
        if src.get("unitRef") and not u_def:
            report["unresolvedFacts"].append({**src, "concept": concept, "reason": f"unitRef '{src['unitRef']}' not defined"})
            continue

        existing = filing.get(concept, ctx["period"], ctx["dims"])
        try:
            val = None if src["nil"] else (src["value"].strip() if (A.is_numeric(concept) or A.data_type(concept) in ("date", "boolean", "enum")) else src["value"])
            if existing:
                canon = None if src["nil"] else filing.canonical_value(concept, val)
                if canon == existing.value:
                    report["duplicates"].append({"concept": concept, "contextRef": src["contextRef"]})
                else:
                    report["conflicts"].append({"concept": concept, "contextRef": src["contextRef"]})
                continue

            fact = filing.set_fact(
                concept=concept,
                period=ctx["period"],
                dims=ctx["dims"],
                value=val,
                nil=src["nil"],
                decimals=src.get("decimals"),
                unit=unit_internal(u_def),
                lang=src.get("lang"),
                origin="import",
                source={
                    "contextRef": src["contextRef"],
                    "unitRef": src.get("unitRef"),
                    "decimals": src.get("decimals"),
                    "lang": src.get("lang"),
                    "id": src.get("id"),
                    "file": file_name,
                },
                fact_id=src.get("id"),
            )
            if A.is_numeric(concept) and not src.get("decimals") and not src["nil"]:
                fact.decimals = None
            if src.get("id"):
                facts_by_id[src["id"]] = fact.key

            report["counts"]["imported"] += 1
            if carry:
                report["byYear"]["carriedOpening"] += 1
                if concept not in report["carriedOpeningConcepts"]:
                    report["carriedOpeningConcepts"].append(concept)
            else:
                dest = {"CY": "previous" if year_mode == "next" else "current", "PY": "previous", "PYO": "previousOpening"}.get(y, "other")
                report["byYear"][dest] += 1
        except FactValueError as e:
            report["unresolvedFacts"].append({**src, "concept": concept, "reason": str(e)})

    report["counts"]["unresolved"] = len(report["unresolvedFacts"])

    # Footnotes
    for child in root:
        c_ns, c_local = split_tag(child.tag)
        if c_ns != NS["link"] or c_local != "footnoteLink":
            continue
        locs: Dict[str, str] = {}
        notes: Dict[str, Dict[str, str]] = {}
        for n in child:
            n_ns, n_local = split_tag(n.tag)
            if n_local == "loc":
                lbl = n.attrib.get(f"{{{NS['xlink']}}}label") or n.attrib.get("xlink:label") or n.attrib.get("label")
                href = n.attrib.get(f"{{{NS['xlink']}}}href") or n.attrib.get("xlink:href") or n.attrib.get("href") or ""
                locs[lbl] = href.replace("#", "")
            elif n_local == "footnote":
                lbl = n.attrib.get(f"{{{NS['xlink']}}}label") or n.attrib.get("xlink:label") or n.attrib.get("label")
                notes[lbl] = {"text": n.text or "", "lang": n.attrib.get("xml:lang") or "en"}

        linked: Dict[str, List[str]] = {}
        for n in child:
            n_ns, n_local = split_tag(n.tag)
            if n_local == "footnoteArc":
                from_lbl = n.attrib.get(f"{{{NS['xlink']}}}from") or n.attrib.get("xlink:from") or n.attrib.get("from")
                to_lbl = n.attrib.get(f"{{{NS['xlink']}}}to") or n.attrib.get("xlink:to") or n.attrib.get("to")
                target_fact_key = facts_by_id.get(locs.get(from_lbl, ""))
                if target_fact_key:
                    linked.setdefault(to_lbl, []).append(target_fact_key)

        for label, note_data in notes.items():
            if year_mode != "both" and not linked.get(label):
                continue
            filing.add_footnote(note_data["text"], linked.get(label, []), note_data["lang"])
            report["counts"]["footnotes"] += 1

    # Meta
    def meta_val(local: str) -> Optional[str]:
        q = A.qname_of_local(local)
        return filing.value(q, "CY", []) if (q and cy.get("end")) else None

    nat = meta_val("NatureOfReportStandaloneConsolidated")
    if nat:
        filing.meta["reportType"] = nat
    lvl = meta_val("LevelOfRoundingUsedInFinancialStatements")
    if lvl:
        filing.meta["level"] = lvl

    pow10 = SCALE_POWERS.get(filing.meta.get("level", "Actual"), 0)
    places = 0
    for f in filing.all():
        if not A.is_monetary(f.concept) or f.nil or f.value is None:
            continue
        req = Dec.required_decimals(Dec.parse(f.value))
        if req != float("inf"):
            places = max(places, int(req) + pow10)
    filing.meta["displayPlaces"] = min(places, 2 + pow10)

    by_places: Dict[int, int] = {}
    for f in filing.all():
        if not A.is_monetary(f.concept) or f.nil or f.decimals in (None, "INF"):
            continue
        p = max(0, int(f.decimals) + pow10)
        by_places[p] = by_places.get(p, 0) + 1
    if by_places:
        common = sorted(by_places.items(), key=lambda x: (x[1], x[0]), reverse=True)[0][0]
        filing.meta["statementPlaces"] = min(common, filing.meta.get("displayPlaces", 0))

    # Cash flow
    report["cashFlow"] = detect_cash_flow(A, filing, "CY" if cy.get("end") else None)
    if report["cashFlow"] and not report["cashFlow"].get("declared"):
        chosen = report["cashFlow"].get("detected") or cash_flow_method
        if not chosen and report["cashFlow"].get("ambiguous"):
            raise CashFlowChoiceError(report["cashFlow"])
        if chosen:
            q = A.qname_of_local("TypeOfCashFlowStatement")
            p = filing.period(q, "CY")
            if p:
                filing.set_fact(
                    concept=q,
                    period=p,
                    value=chosen,
                    origin="derived" if report["cashFlow"].get("detected") else "user",
                    lang="en",
                )
                report["cashFlow"]["applied"] = chosen
                report["warnings"].append(f"TypeOfCashFlowStatement set to '{chosen}'")
    elif report["cashFlow"]:
        report["cashFlow"]["applied"] = report["cashFlow"].get("declared")

    # Next year
    if year_mode == "next" and cy.get("end"):
        ncy = {"start": add_days(cy["end"], 1), "end": same_day_next_year(cy["end"])}
        filing.meta["periods"] = {"cy": ncy, "py": dict(cy)}
        filing.meta["firstFinancialYear"] = False
        report["nextYear"] = {"cy": ncy, "py": dict(cy)}
        q = A.qname_of_local("TypeOfCashFlowStatement")
        if report.get("cashFlow", {}).get("applied") and q:
            p = filing.period(q, "CY")
            if p:
                filing.set_fact(concept=q, period=p, value=report["cashFlow"]["applied"], origin="derived", lang="en")

    # Applicability pruning
    filing.meta["yearMode"] = year_mode
    app = Applicability(A)
    for _ in range(6):
        planned = app.plan_facts(filing)
        excluded = planned.get("excluded", [])
        if not excluded:
            break
        for x in excluded:
            f = x["fact"]
            filing.remove_fact(f.key)
            y = scope_of(filing.meta.get("periods", {}), f.period)
            dest = "carriedOpening" if (y == "PY" and f.period.get("type") == "instant" and f.concept in opening_concepts(A) and year_mode == "current") else ({"CY": "current", "PY": "previous", "PYO": "previousOpening"}.get(y, "other"))
            if report["byYear"].get(dest, 0) > 0:
                report["byYear"][dest] -= 1
            report["counts"]["imported"] -= 1
            report["notApplicable"].append({
                "concept": f.concept,
                "period": f.period,
                "dims": f.dims,
                "value": None if f.nil else f.value,
                "scope": y,
                "reasons": x.get("reasons", []),
                "contextRef": f.source.get("contextRef") if f.source else None,
            })

    filing.set_aside = set_aside
    filing.import_report = report
    return {"filing": filing, "report": report}


importInstance = import_instance
