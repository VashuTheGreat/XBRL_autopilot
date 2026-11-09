"""
a.py - Simple MCA C&I Taxonomy 2016 & Business Rules Parser
Target: ci_knowledge_base.json banane ke liye simple aur readable code.
"""

import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from python_calamine import CalamineWorkbook
from src.constants import (
    BASE_DIR,
    CI_TAXONOMY_DIR as TAXONOMY_DIR,
    CI_RULES_EXCEL as RULES_EXCEL,
    CI_OUTPUT_JSON as OUTPUT_JSON

)
import os
from src.utils.main_utils import save_json

# -------------------------------------------------------------------------
# 1. PATHS SETUP (Auto-detects project root)
# -------------------------------------------------------------------------
def get_project_root() -> Path:
    for p in [Path.cwd(), *Path.cwd().parents]:
        if (p / 'data' / 'c&I taxonomy').exists():
            return p
    return Path('/home/vanshsharma/projects/xbrl_autopilot')


print(f'Project root detected: {BASE_DIR}')
print(f'Taxonomy exists: {TAXONOMY_DIR.exists()}')
print(f'Rules Excel exists: {RULES_EXCEL.exists()}')

# XML Namespaces
XS = "{http://www.w3.org/2001/XMLSchema}"
LINK = "{http://www.xbrl.org/2003/linkbase}"
XLINK = "{http://www.w3.org/1999/xlink}"
XBRLI = "{http://www.xbrl.org/2003/instance}"


# -------------------------------------------------------------------------
# 2. STEP 1: PARSE XSD SCHEMAS (CONCEPTS, TYPES, ROLES)
# -------------------------------------------------------------------------
def parse_schemas():
    print("[1/4] Parsing XSD schemas...")
    namespaces = {
        "in-ca": "http://www.icai.org/xbrl/taxonomy/2016-03-31/in-ca",
        "in-ca-roles": "http://www.icai.org/xbrl/taxonomy/2016-03-31/in-ca-roles",
        "in-ca-types": "http://www.icai.org/xbrl/taxonomy/2016-03-31/in-ca-types",
        "in-ci-ent": "http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap/in-ci-ent",
        "in-gaap": "http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap",
        "in-gaap-roles": "http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap-roles",
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

        # Prefix find karo (in-ca ya in-gaap etc.)
        prefix = next((p for p, uri in namespaces.items() if uri == tns), None)
        if not prefix:
            continue

        # A. Custom Types (like PANNumber, DINNumber, Enums)
        for ct in root.findall(f".//{XS}complexType"):
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

        # B. Roles (ELRs like Balance Sheet, P&L, Notes)
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

        # C. Concepts (Elements: Assets, Liabilities, Revenue, etc.)
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

    print(f"  -> {len(concepts)} concepts, {len(types)} types, {len(roles)} roles found.")
    return namespaces, concepts, types, roles, id_to_qname


# -------------------------------------------------------------------------
# 3. STEP 2: PARSE LABELS (EN + HI) & REFERENCES
# -------------------------------------------------------------------------
def parse_labels_and_references(concepts, id_to_qname):
    print("[2/4] Parsing English & Hindi labels, and MCA references...")
    
    # Label files
    for lab_file in sorted(TAXONOMY_DIR.rglob("*-lab-*.xml")):
        tree = ET.parse(lab_file)
        root = tree.getroot()
        
        # Locators map: xlink:label -> concept QName
        locs = {}
        for loc in root.findall(f".//{LINK}loc"):
            lbl = loc.attrib.get(f"{XLINK}label")
            href = loc.attrib.get(f"{XLINK}href", "")
            frag = href.split("#")[-1]
            qn = id_to_qname.get(frag)
            if qn:
                locs[lbl] = qn

        # Resource map: xlink:label -> label text & lang
        resources = {}
        for r in root.findall(f".//{LINK}label"):
            lbl = r.attrib.get(f"{XLINK}label")
            lang = r.attrib.get("{http://www.w3.org/XML/1998/namespace}lang") or r.attrib.get("xml:lang") or "en"
            role = (r.attrib.get(f"{XLINK}role") or "").split("/")[-1] or "label"
            resources[lbl] = (r.text.strip() if r.text else "", lang, role)

        # Connect using labelArc
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
            if qn:
                locs[lbl] = qn

        # Resource map: xlink:label -> reference dict
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

    # Add fallback labels for typed domain containers (MCA does not provide labels in XML for these)
    for qn, c in concepts.items():
        if not c["labels"].get("label"):
            if c["name"].endswith("Domain"):
                c["isTypedDomain"] = True
                readable = re.sub(r'(?<!^)(?=[A-Z])', ' ', c["name"])
                if readable.lower().endswith('domain'):
                    readable = re.sub(r'\s*domain$', '', readable, flags=re.I) + ' [Domain]'
                c["labels"]["label"] = readable

    print("  -> Labels and references merged into concepts.")


# -------------------------------------------------------------------------
# 4. STEP 3: PARSE LINKBASES (PRE, CAL, DEF RELATIONSHIPS)
# -------------------------------------------------------------------------
def parse_relationships(id_to_qname):
    print("[3/4] Parsing PRE, CAL, DEF linkbases...")
    presentation = {}
    calculation = {}
    definition = {}

    for xml_file in sorted(TAXONOMY_DIR.rglob("*.xml")):
        if any(k in str(xml_file) for k in ["-lab-", "-ref-", "META-INF"]):
            continue

        tree = ET.parse(xml_file)
        root = tree.getroot()

        for link in root:
            elr = link.attrib.get(f"{XLINK}role")
            if not elr:
                continue

            # Map locators
            locs = {}
            for loc in link.findall(f"{LINK}loc"):
                lbl = loc.attrib.get(f"{XLINK}label")
                frag = loc.attrib.get(f"{XLINK}href", "").split("#")[-1]
                qn = id_to_qname.get(frag)
                if qn:
                    locs[lbl] = qn

            # A. Presentation Link (Hierarchies)
            for arc in link.findall(f"{LINK}presentationArc"):
                f = locs.get(arc.attrib.get(f"{XLINK}from"))
                t = locs.get(arc.attrib.get(f"{XLINK}to"))
                if f and t:
                    order = float(arc.attrib.get("order", "1.0"))
                    presentation.setdefault(elr, []).append({
                        "from": f, "to": t, "order": int(order) if order.is_integer() else order
                    })

            # B. Calculation Link (Summations & Weights)
            for arc in link.findall(f"{LINK}calculationArc"):
                f = locs.get(arc.attrib.get(f"{XLINK}from"))
                t = locs.get(arc.attrib.get(f"{XLINK}to"))
                if f and t:
                    w = float(arc.attrib.get("weight", "1.0"))
                    order = float(arc.attrib.get("order", "1.0"))
                    calculation.setdefault(elr, []).append({
                        "from": f, "to": t, "weight": int(w) if w.is_integer() else w, "order": int(order) if order.is_integer() else order
                    })

            # C. Definition Link (Dimensions & Tables)
            for arc in link.findall(f"{LINK}definitionArc"):
                f = locs.get(arc.attrib.get(f"{XLINK}from"))
                t = locs.get(arc.attrib.get(f"{XLINK}to"))
                if f and t:
                    arcrole = arc.attrib.get(f"{XLINK}arcrole", "").split("/")[-1]
                    order = float(arc.attrib.get("order", "1.0"))
                    definition.setdefault(elr, []).append({
                        "arcrole": arcrole, "from": f, "to": t, "order": int(order) if order.is_integer() else order
                    })

    # Sort arcs by order
    for d in [presentation, calculation, definition]:
        for k in d:
            d[k].sort(key=lambda x: (x["from"], x["order"]))

    print(f"  -> PRE roles: {len(presentation)}, CAL roles: {len(calculation)}, DEF roles: {len(definition)}.")
    return presentation, calculation, definition


# -------------------------------------------------------------------------
# 5. STEP 4: PARSE BUSINESS RULES (MANDATORY & NULL CHECKS)
# -------------------------------------------------------------------------
def parse_business_rules(concepts):
    print("[4/4] Parsing Business Rules from Excel (mandatory/null checks)...")
    business_rules = {
        "mandatoryConcepts": [],      # Globally mandatory elements (cannot be null)
        "mandatoryConsolidated": [],  # Mandatory in Consolidated reports
        "mandatoryLineItems": {},     # Table -> List of mandatory fields
        "rules": [],
    }

    if not RULES_EXCEL.exists():
        print(f"  ! Warning: Business rules excel not found at {RULES_EXCEL}")
        return business_rules

    wb = CalamineWorkbook.from_path(RULES_EXCEL)
    sheet_names = wb.sheet_names

    # Concept name lookup helper
    by_name = {c["name"].lower(): qn for qn, c in concepts.items()}

    # A. Specific rules for elements (Mandatory Null checks)
    if "Specific rules for elements" in sheet_names:
        rows = wb.get_sheet_by_name("Specific rules for elements").to_python()
        cur_code = None
        for r in rows:
            c0 = str(r[0] or "").strip()
            c1 = str(r[1] or "").strip()
            if c0.startswith("[") and "]" in c0:
                cur_code = re.match(r"^\[([0-9]{6}[a-z]?)\]", c0).group(1)
                continue
            if not c1 or c0 == "ELR/ Element Name":
                continue

            qn = by_name.get(c0.lower())
            rule_text = c1.lower()

            if "mandatory in case of consolidated" in rule_text:
                if qn and qn not in business_rules["mandatoryConsolidated"]:
                    business_rules["mandatoryConsolidated"].append(qn)
                    concepts[qn]["isMandatoryConsolidated"] = True
                rule_type = "mandatory-consolidated"
            elif "is a mandatory field" in rule_text or "this is a mandatory field" in rule_text or "mandatory field" in rule_text:
                if qn and qn not in business_rules["mandatoryConcepts"]:
                    business_rules["mandatoryConcepts"].append(qn)
                    concepts[qn]["isMandatory"] = True
                rule_type = "mandatory"
            else:
                rule_type = "validation-rule"

            business_rules["rules"].append({
                "element": c0,
                "concept": qn,
                "elr": cur_code,
                "type": rule_type,
                "ruleText": c1
            })

    # B. Mandatory Line Items for Tables (Table row null checks)
    ml_sheet = next((s for s in sheet_names if "mandatory line" in s.lower()), None)
    if ml_sheet:
        ml_rows = wb.get_sheet_by_name(ml_sheet).to_python()
        for r in ml_rows[3:]:
            if len(r) >= 3 and r[0] is not None:
                tbl_raw = str(r[1] or "").strip()
                items_raw = str(r[2] or "").strip()
                
                # Element names extract karo
                mand_qns = []
                for item in re.split(r"[,\n]+|\sand\s", items_raw):
                    clean_item = re.sub(r"^(Mandatory elements are\s*-\s*|Elements mandatory are\s*-\s*|Element for\s*)", "", item, flags=re.I).strip().strip("'\"")
                    clean_item = re.sub(r"\(closing\)", "", clean_item, flags=re.I).strip()
                    cqn = by_name.get(clean_item.lower())
                    if cqn:
                        mand_qns.append(cqn)

                if mand_qns:
                    business_rules["mandatoryLineItems"][tbl_raw] = mand_qns

    print(f"  -> {len(business_rules['mandatoryConcepts'])} globally mandatory concepts found (cannot be null).")
    print(f"  -> {len(business_rules['mandatoryLineItems'])} tables with mandatory line-items extracted.")
    return business_rules


# -------------------------------------------------------------------------
# 6. MAIN COMPILER: RUN ALL & EXPORT JSON
# -------------------------------------------------------------------------
async def main():
    print("=" * 60)
    print("Starting C&I Taxonomy 2016 Extraction Pipeline")
    print("=" * 60)

    # 1. Schemas
    namespaces, concepts, types, roles, id_to_qname = parse_schemas()

    # 2. Labels & References
    parse_labels_and_references(concepts, id_to_qname)

    # 3. Relationships
    presentation, calculation, definition = parse_relationships(id_to_qname)

    # 4. Business Rules
    business_rules = parse_business_rules(concepts)

    # Assemble JSON
    canonical_kb = {
        "meta": {
            "name": "MCA C&I Taxonomy 2016 authority model",
            "taxonomyVersion": "Indian C&I General Purpose Taxonomy 2016-03-31 Ver 1.0",
            "entryPoint": "in-ci-ent-2016-03-31.xsd",
            "schemaRef": "https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd",
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

    directory = os.path.dirname(OUTPUT_JSON)
    os.makedirs(directory,exist_ok=True)
        
    # Save to file
    await save_json(path=OUTPUT_JSON,data=canonical_kb)
    
    print("=" * 60)
    print(f"DONE! File generated: {OUTPUT_JSON}")
    print(f"Size: {OUTPUT_JSON.stat().st_size / (1024*1024):.2f} MB")
    print("=" * 60)

