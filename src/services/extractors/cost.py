"""
b.py - Simple MCA Costing Taxonomy 2019 & Business Rules Parser
Target: cost_knowledge_base.json banane ke liye simple aur readable code.
"""

import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from python_calamine import CalamineWorkbook
from src.constants import (
    BASE_DIR,
    COST_ROOT as COST_ROOT,
    COST_TAXONOMY_DIR as TAXONOMY_DIR,
    COST_RULES_EXCEL as RULES_EXCEL,
    COST_OUTPUT_JSON as OUTPUT_JSON
)
import os
from src.core.logger import logger
from src.utils.main_utils import save_json

logger.debug("cost_extractor.paths", base_dir=str(BASE_DIR), taxonomy_exists=TAXONOMY_DIR.exists(), rules_exists=RULES_EXCEL.exists())

# XML Namespaces
XS = "{http://www.w3.org/2001/XMLSchema}"
LINK = "{http://www.xbrl.org/2003/linkbase}"
XLINK = "{http://www.w3.org/1999/xlink}"
XBRLI = "{http://www.xbrl.org/2003/instance}"


# -------------------------------------------------------------------------
# 2. STEP 1: PARSE XSD SCHEMAS (CONCEPTS, TYPES, ROLES)
# -------------------------------------------------------------------------
def parse_schemas():
    logger.info("cost_extractor.parse_schemas_started")
    namespaces = {
        "in-cost": "http://www.icmai.in/xbrl/2018-04-01/in-cost",
        "in-cost-type": "http://www.icmai.in/xbrl/2018-04-01/in-cost-type",
        "in-cost-aud": "http://www.icmai.in/xbrl/2018-04-01/in-cost-aud",
        "in-cost-aud-role": "http://www.icmai.in/xbrl/2018-04-01/in-cost-aud-role",
    }
    
    concepts = {}
    types = {}
    roles = {}
    id_to_qname = {}

    for xsd_file in sorted(TAXONOMY_DIR.rglob("*.xsd")):
        rel_path = str(xsd_file.relative_to(TAXONOMY_DIR))
        tree = ET.parse(xsd_file)
        root = tree.getroot()
        tns = root.attrib.get("targetNamespace", "")

        prefix = next((p for p, uri in namespaces.items() if uri == tns), None)
        if not prefix:
            continue

        # A. Custom Types
        for ct in root.findall(f".//{XS}complexType") + root.findall(f".//{XS}simpleType"):
            name = ct.attrib.get("name")
            restr = ct.find(f".//{XS}restriction")
            if name and restr is not None:
                enums = [e.attrib.get("value") for e in restr.findall(f"{XS}enumeration")]
                pat = restr.find(f"{XS}pattern")
                length = restr.find(f"{XS}length")
                
                t_data = {"base": restr.attrib.get("base", "xbrli:stringItemType"), "source": rel_path}
                if enums: t_data["enumerations"] = enums
                if pat is not None: t_data["pattern"] = pat.attrib.get("value")
                if length is not None: t_data["length"] = length.attrib.get("value")
                types[f"{prefix}:{name}"] = t_data

        # B. Roles (ELRs like Cost Audit Report, General Information)
        for rt in root.findall(f".//{LINK}roleType"):
            uri = rt.attrib.get("roleURI")
            def_el = rt.find(f"{LINK}definition")
            def_text = def_el.text.strip() if def_el is not None and def_el.text else ""
            m = re.match(r"^\[([0-9]{6}[a-z]?)\]", def_text)
            code = m.group(1) if m else uri.split("/")[-1]
            roles[uri] = {
                "id": rt.attrib.get("id"),
                "definition": def_text,
                "code": code,
                "source": rel_path,
            }

        # C. Concepts
        for elem in root.findall(f"{XS}element"):
            name = elem.attrib.get("name")
            if not name:
                continue
            qname = f"{prefix}:{name}"
            elem_id = elem.attrib.get("id")

            concepts[qname] = {
                "qname": qname,
                "name": name,
                "prefix": prefix,
                "namespace": tns,
                "type": elem.attrib.get("type"),
                "periodType": elem.attrib.get(f"{XBRLI}periodType"),
                "balance": elem.attrib.get(f"{XBRLI}balance"),
                "abstract": elem.attrib.get("abstract") == "true",
                "nillable": elem.attrib.get("nillable") == "true",
                "source": rel_path,
                "labels": {},
                "references": [],
            }
            if elem_id:
                id_to_qname[f"{xsd_file.name}#{elem_id}"] = qname
                id_to_qname[elem_id] = qname

    logger.info("cost_extractor.schemas_parsed", concepts=len(concepts), types=len(types), roles=len(roles))
    return namespaces, concepts, types, roles, id_to_qname


# -------------------------------------------------------------------------
# 3. STEP 2: PARSE LABELS (EN + HI) & REFERENCES
# -------------------------------------------------------------------------
def parse_labels_and_references(concepts, id_to_qname):
    logger.info("cost_extractor.parse_labels_and_references_started")
    
    # Label files
    for lab_file in sorted(TAXONOMY_DIR.rglob("*-lab-*.xml")):
        tree = ET.parse(lab_file)
        root = tree.getroot()
        
        locs = {}
        for loc in root.findall(f".//{LINK}loc"):
            lbl = loc.attrib.get(f"{XLINK}label")
            href = loc.attrib.get(f"{XLINK}href", "")
            frag = href.split("#")[-1]
            qn = id_to_qname.get(frag)
            if not qn and "_" in frag:
                p, _, n = frag.partition("_")
                if f"{p}:{n}" in concepts:
                    qn = f"{p}:{n}"
            if qn:
                locs[lbl] = qn

        resources = {}
        for r in root.findall(f".//{LINK}label"):
            lbl = r.attrib.get(f"{XLINK}label")
            lang = r.attrib.get("{http://www.w3.org/XML/1998/namespace}lang") or r.attrib.get("xml:lang") or "en"
            role = (r.attrib.get(f"{XLINK}role") or "").split("/")[-1] or "label"
            resources[lbl] = (r.text.strip() if r.text else "", lang, role)

        for arc in root.findall(f".//{LINK}labelArc"):
            from_lbl = arc.attrib.get(f"{XLINK}from")
            to_lbl = arc.attrib.get(f"{XLINK}to")
            qn = locs.get(from_lbl)
            if qn and to_lbl in resources and qn in concepts:
                text, lang, role = resources[to_lbl]
                if lang == "hi":
                    concepts[qn]["labels"]["label_hi"] = text
                else:
                    concepts[qn]["labels"][role] = text

    # Reference files
    for ref_file in sorted(TAXONOMY_DIR.rglob("*-ref-*.xml")):
        tree = ET.parse(ref_file)
        root = tree.getroot()
        locs = {}
        for loc in root.findall(f".//{LINK}loc"):
            lbl = loc.attrib.get(f"{XLINK}label")
            frag = loc.attrib.get(f"{XLINK}href", "").split("#")[-1]
            qn = id_to_qname.get(frag)
            if not qn and "_" in frag:
                p, _, n = frag.partition("_")
                if f"{p}:{n}" in concepts:
                    qn = f"{p}:{n}"
            if qn:
                locs[lbl] = qn

        ref_resources = {}
        for r in root.findall(f".//{LINK}reference"):
            lbl = r.attrib.get(f"{XLINK}label")
            parts = {child.tag.split("}")[-1]: child.text.strip() for child in r if child.text}
            if lbl and parts:
                ref_resources[lbl] = parts

        for arc in root.findall(f".//{LINK}referenceArc"):
            qn = locs.get(arc.attrib.get(f"{XLINK}from"))
            to_lbl = arc.attrib.get(f"{XLINK}to")
            if qn and to_lbl in ref_resources and qn in concepts:
                concepts[qn]["references"].append(ref_resources[to_lbl])

    logger.info("cost_extractor.labels_and_references_merged")


# -------------------------------------------------------------------------
# 4. STEP 3: PARSE LINKBASES (PRE, CAL, DEF RELATIONSHIPS)
# -------------------------------------------------------------------------
def parse_relationships(concepts, id_to_qname):
    logger.info("cost_extractor.parse_relationships_started")
    presentation = {}
    calculation = {}
    definition = {}

    def resolve_qn(frag):
        qn = id_to_qname.get(frag)
        if not qn and "_" in frag:
            p, _, n = frag.partition("_")
            if f"{p}:{n}" in concepts:
                qn = f"{p}:{n}"
        return qn

    for xml_file in sorted(TAXONOMY_DIR.rglob("*.xml")):
        if any(k in str(xml_file) for k in ["-lab-", "-ref-", "META-INF"]):
            continue

        tree = ET.parse(xml_file)
        root = tree.getroot()

        for link in root:
            elr = link.attrib.get(f"{XLINK}role")
            if not elr:
                continue

            locs = {}
            for loc in link.findall(f"{LINK}loc"):
                lbl = loc.attrib.get(f"{XLINK}label")
                frag = loc.attrib.get(f"{XLINK}href", "").split("#")[-1]
                qn = resolve_qn(frag)
                if qn:
                    locs[lbl] = qn

            # A. Presentation Link
            for arc in link.findall(f"{LINK}presentationArc"):
                f = locs.get(arc.attrib.get(f"{XLINK}from"))
                t = locs.get(arc.attrib.get(f"{XLINK}to"))
                if f and t:
                    order = float(arc.attrib.get("order", "1.0"))
                    presentation.setdefault(elr, []).append({
                        "from": f, "to": t, "order": int(order) if order.is_integer() else order
                    })

            # B. Calculation Link
            for arc in link.findall(f"{LINK}calculationArc"):
                f = locs.get(arc.attrib.get(f"{XLINK}from"))
                t = locs.get(arc.attrib.get(f"{XLINK}to"))
                if f and t:
                    w = float(arc.attrib.get("weight", "1.0"))
                    order = float(arc.attrib.get("order", "1.0"))
                    calculation.setdefault(elr, []).append({
                        "from": f, "to": t, "weight": int(w) if w.is_integer() else w, "order": int(order) if order.is_integer() else order
                    })

            # C. Definition Link
            for arc in link.findall(f"{LINK}definitionArc"):
                f = locs.get(arc.attrib.get(f"{XLINK}from"))
                t = locs.get(arc.attrib.get(f"{XLINK}to"))
                if f and t:
                    arcrole = arc.attrib.get(f"{XLINK}arcrole", "").split("/")[-1]
                    order = float(arc.attrib.get("order", "1.0"))
                    definition.setdefault(elr, []).append({
                        "arcrole": arcrole, "from": f, "to": t, "order": int(order) if order.is_integer() else order
                    })

    for d in [presentation, calculation, definition]:
        for k in d:
            d[k].sort(key=lambda x: (x["from"], x["order"]))

    logger.info(
        "cost_extractor.relationships_parsed",
        presentation_roles=len(presentation),
        calculation_roles=len(calculation),
        definition_roles=len(definition),
    )
    return presentation, calculation, definition


# -------------------------------------------------------------------------
# 5. STEP 4: PARSE BUSINESS RULES (MANDATORY & NULL CHECKS)
# -------------------------------------------------------------------------
def parse_business_rules(concepts):
    logger.info("cost_extractor.parse_business_rules_started")
    business_rules = {
        "mandatoryConcepts": [],      # Cannot be null
        "conditionalMandatory": [],   # Mandatory on condition (e.g. date check)
        "mandatoryLineItems": {},     # Table -> List of mandatory fields
        "genericRules": [],
        "rules": [],
    }

    if not RULES_EXCEL.exists():
        logger.warning("cost_extractor.rules_excel_missing", path=str(RULES_EXCEL))
        return business_rules

    wb = CalamineWorkbook.from_path(RULES_EXCEL)
    sheet_names = wb.sheet_names

    by_name = {c["name"].lower(): qn for qn, c in concepts.items()}

    # A. Specific rules-CAR (Mandatory Null checks)
    spec_sheet = next((s for s in sheet_names if "specific rules" in s.lower()), None)
    if spec_sheet:
        rows = wb.get_sheet_by_name(spec_sheet).to_python()
        cur_elr = None
        for r in rows[1:]:
            c0 = str(r[0] or "").strip()
            c1 = str(r[1] or "").strip()
            c2 = str(r[2] or "").strip()
            c3 = str(r[3] or "").strip() if len(r) > 3 else ""

            if c0 == "ELR":
                m = re.search(r"\[([0-9]{6}[a-z]?)\]", c1)
                cur_elr = m.group(1) if m else c1
                continue
            if not c2 or c2 == "Element Name" or not c3:
                continue

            qn = by_name.get(c2.lower())
            rule_lower = c3.lower()

            if "mandatory" in rule_lower and not rule_lower.startswith("mandatory if"):
                if qn and qn not in business_rules["mandatoryConcepts"]:
                    business_rules["mandatoryConcepts"].append(qn)
                    concepts[qn]["isMandatory"] = True
                rule_type = "mandatory"
            elif "mandatory if" in rule_lower:
                if qn and qn not in business_rules["conditionalMandatory"]:
                    business_rules["conditionalMandatory"].append(qn)
                    concepts[qn]["isMandatoryConditional"] = True
                rule_type = "conditional-mandatory"
            else:
                rule_type = "validation-rule"

            business_rules["rules"].append({
                "element": c2,
                "concept": qn,
                "elr": cur_elr,
                "type": rule_type,
                "ruleText": c3
            })

    # B. Mandatory line item CAR
    ml_sheet = next((s for s in sheet_names if "mandatory line item" in s.lower()), None)
    if ml_sheet:
        ml_rows = wb.get_sheet_by_name(ml_sheet).to_python()
        cur_tbl = None
        for r in ml_rows[2:]:
            if len(r) < 3: continue
            c1 = str(r[1] or "").strip()
            c2 = str(r[2] or "").strip()
            if c1 and c1 != "Table name":
                cur_tbl = c1
            if cur_tbl and c2 and c2 != "Mandatory line-items":
                cqn = by_name.get(c2.lower())
                business_rules["mandatoryLineItems"].setdefault(cur_tbl, []).append(cqn if cqn else c2)

    # C. Generic Business rules
    gen_sheet = next((s for s in sheet_names if "generic" in s.lower()), None)
    if gen_sheet:
        gen_rows = wb.get_sheet_by_name(gen_sheet).to_python()
        for r in gen_rows:
            if len(r) >= 2 and r[0] is not None and str(r[0]).strip().replace(".0", "").isdigit():
                business_rules["genericRules"].append({
                    "sno": int(float(r[0])),
                    "description": str(r[1]).strip()
                })

    logger.info(
        "cost_extractor.business_rules_parsed",
        mandatory_concepts=len(business_rules["mandatoryConcepts"]),
        mandatory_tables=len(business_rules["mandatoryLineItems"]),
    )
    return business_rules


# -------------------------------------------------------------------------
# 6. MAIN COMPILER: RUN ALL & EXPORT JSON
# -------------------------------------------------------------------------
async def main():
    with logger.span("cost_extractor.pipeline"):
        logger.info("cost_extractor.starting")

        # 1. Schemas
        namespaces, concepts, types, roles, id_to_qname = parse_schemas()

        # 2. Labels & References
        parse_labels_and_references(concepts, id_to_qname)

        # 3. Relationships
        presentation, calculation, definition = parse_relationships(concepts, id_to_qname)

        # 4. Business Rules
        business_rules = parse_business_rules(concepts)

        # Assemble JSON
        canonical_kb = {
            "meta": {
                "name": "MCA Costing Taxonomy 2019 authority model",
                "taxonomyVersion": "Costing Taxonomy 2019 Version 1.1@31-03-2019",
                "entryPoint": "in-cost-aud-2018-04-01.xsd",
                "schemaRef": "http://www.icmai.in/xbrl/2018-04-01/in-cost-aud/in-cost-aud-2018-04-01.xsd",
                "totalConcepts": len(concepts),
                "mandatoryConceptsCount": len(business_rules["mandatoryConcepts"]),
            },
            "namespaces": namespaces,
            "types": types,
            "roles": roles,
            "concepts": concepts,
            "presentation": presentation,
            "calculation": calculation,
            "definition": definition,
            "businessRules": business_rules,
        }

        # Save to file
        directory = os.path.dirname(OUTPUT_JSON)
        os.makedirs(directory, exist_ok=True)
        await save_json(OUTPUT_JSON, data=canonical_kb)

        size_mb = OUTPUT_JSON.stat().st_size / (1024 * 1024) if OUTPUT_JSON.exists() else 0.0
        logger.info("cost_extractor.completed", output_path=str(OUTPUT_JSON), size_mb=round(size_mb, 2))

