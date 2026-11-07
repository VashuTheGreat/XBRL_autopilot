"""Taxonomy Knowledge Base Compiler.

Parses official MCA taxonomy packages (schemas, linkbases, and business rules)
into standardized, self-contained JSON knowledge bases:
  - Knowlege_base/ci_knowledge_base.json (C&I 2016)
  - Knowlege_base/ind_as_knowledge_base.json (Ind AS V1.2)
  - Knowlege_base/costing_knowledge_base.json (Costing 2019)

Each compiled knowledge base contains:
  - meta: name, taxonomyVersion, entryPoint, schemaRef, namespaces
  - concepts: dictionary of concept definitions, datatypes, periodTypes, balances, labels
  - elrs: list of extended link roles (code, title, group, uri)
  - presentation: mapping of ELR URI -> list of parent-child presentation arcs
  - calculation: mapping of ELR URI -> list of calculation arcs with weights
  - definition: mapping of ELR URI -> list of definition arcs
  - dimensionDefaults: default dimension members
  - tables: hypercube and table structures
  - businessRules: executable validation rules compiled from official MCA rulebooks
"""

from __future__ import annotations
import datetime
import io
import json
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import xml.etree.ElementTree as ET
import zipfile
import openpyxl

from src.core.logger import logger

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
KB_DIR = ROOT_DIR / "Knowlege_base"
KB_DIR.mkdir(parents=True, exist_ok=True)

# Standard XML Namespaces used in XBRL 2.1 linkbases and schemas
NS_XS = "{http://www.w3.org/2001/XMLSchema}"
NS_LINK = "{http://www.xbrl.org/2003/linkbase}"
NS_XLINK = "{http://www.w3.org/1999/xlink}"
NS_XBRLI = "http://www.xbrl.org/2003/instance"


def clean_label(text: Optional[str]) -> str:
    if not text:
        return ""
    return " ".join(text.strip().split())


class TaxonomyCompiler:
    """Compiles C&I, Ind AS, and Costing taxonomies into standardized JSON knowledge bases."""

    def __init__(self):
        self.kb_dir = KB_DIR

    # =========================================================================
    # 1. C&I TAXONOMY 2016
    # =========================================================================
    def compile_ci(self) -> Path:
        """Standardizes C&I 2016 knowledge base artifact."""
        logger.info("compiler.ci.starting")
        ci_target = self.kb_dir / "ci_knowledge_base.json"
        auth_file = self.kb_dir / "MCA_AUTHORITY.json"

        # If MCA_AUTHORITY.json already exists and is complete, load and standardize it
        if auth_file.exists():
            with open(auth_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["meta"]["taxonomyType"] = "ci"
            data["meta"]["schemaRef"] = "https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd"
            with open(ci_target, "w", encoding="utf-8") as f:
                json.dump(data, f)
            logger.info("compiler.ci.completed", concepts=len(data.get("concepts", {})))
            return ci_target

        raise FileNotFoundError(f"Missing base authority file at {auth_file}")

    # =========================================================================
    # 2. COSTING TAXONOMY 2019
    # =========================================================================
    def compile_costing(self) -> Path:
        """Extracts and compiles Costing Taxonomy 2019 into costing_knowledge_base.json."""
        logger.info("compiler.costing.starting")
        zip_path = (
            DATA_DIR
            / "Costing Taxonomy"
            / "Costing Taxonomy 2019 Version 1.1@31-03-2019"
            / "FinalCostingTaxonomy2019_V1.1"
            / "Costing Taxonomy 2019.zip"
        )
        excel_path = (
            DATA_DIR
            / "Costing Taxonomy"
            / "Costing Taxonomy 2019 Version 1.1@31-03-2019"
            / "FinalCostingTaxonomy2019_V1.1"
            / "CostingTaxonomy2019_Cost Audit.xlsx"
        )
        rules_path = (
            DATA_DIR
            / "Costing Taxonomy"
            / "Business rule based on Costing taxonomy 2019 V1.1@06-10-2019"
            / "Final_BusinessRules_based_on_CostingTaxonomy2019_V1.1.xlsx"
        )

        concepts: Dict[str, Dict[str, Any]] = {}
        elrs: List[Dict[str, Any]] = []
        elr_by_uri: Dict[str, Dict[str, Any]] = {}
        presentation: Dict[str, List[Dict[str, Any]]] = {}
        calculation: Dict[str, List[Dict[str, Any]]] = {}
        definition: Dict[str, List[Dict[str, Any]]] = {}
        dimension_defaults: Dict[str, str] = {}
        tables: List[Dict[str, Any]] = []

        if not zip_path.exists():
            raise FileNotFoundError(f"Missing Costing zip package at {zip_path}")

        with zipfile.ZipFile(zip_path) as z:
            # 1. Parse schemas for concept definitions
            schema_files = [n for n in z.namelist() if n.endswith(".xsd") and "role" not in n]
            for sname in schema_files:
                tree = ET.fromstring(z.read(sname))
                for elem in tree.findall(f".//{NS_XS}element"):
                    name = elem.attrib.get("name")
                    if not name:
                        continue
                    qname = f"in-cost:{name}"
                    concepts[qname] = {
                        "qname": qname,
                        "name": name,
                        "type": elem.attrib.get("type", "xbrli:stringItemType"),
                        "periodType": elem.attrib.get(f"{{{NS_XBRLI}}}periodType", "duration"),
                        "balance": elem.attrib.get(f"{{{NS_XBRLI}}}balance"),
                        "abstract": elem.attrib.get("abstract") == "true",
                        "substitutionGroup": elem.attrib.get("substitutionGroup", "xbrli:item"),
                        "labels": {},
                    }

            # 2. Parse label linkbases
            label_files = [n for n in z.namelist() if "-lab-" in n and n.endswith(".xml")]
            for lname in label_files:
                tree = ET.fromstring(z.read(lname))
                locators: Dict[str, str] = {}
                for loc in tree.findall(f".//{NS_LINK}loc"):
                    label_key = loc.attrib.get(f"{NS_XLINK}label")
                    href = loc.attrib.get(f"{NS_XLINK}href", "")
                    frag = href.split("#")[-1]
                    concept_name = frag.replace("in-cost_", "").replace("in-cost-aud_", "")
                    locators[label_key] = f"in-cost:{concept_name}"

                labels_by_loc: Dict[str, str] = {}
                for lbl in tree.findall(f".//{NS_LINK}label"):
                    lbl_key = lbl.attrib.get(f"{NS_XLINK}label")
                    labels_by_loc[lbl_key] = clean_label(lbl.text)

                for arc in tree.findall(f".//{NS_LINK}labelArc"):
                    from_k = arc.attrib.get(f"{NS_XLINK}from")
                    to_k = arc.attrib.get(f"{NS_XLINK}to")
                    qname = locators.get(from_k)
                    text = labels_by_loc.get(to_k)
                    if qname and text and qname in concepts:
                        concepts[qname]["labels"]["label"] = text

            # 3. Augment with Labels sheet from Excel if present
            if excel_path.exists():
                wb = openpyxl.load_workbook(excel_path, read_only=True)
                if "Labels" in wb.sheetnames:
                    ws = wb["Labels"]
                    for row in ws.iter_rows(values_only=True):
                        if len(row) >= 4 and row[2] and row[2] != "Element Name":
                            prefix = str(row[1] or "in-cost").strip()
                            cname = str(row[2]).strip()
                            label_val = str(row[3] or cname).strip()
                            qname = f"{prefix}:{cname}"
                            if qname in concepts:
                                if not concepts[qname]["labels"].get("label"):
                                    concepts[qname]["labels"]["label"] = label_val
                            else:
                                concepts[qname] = {
                                    "qname": qname,
                                    "name": cname,
                                    "type": "xbrli:stringItemType",
                                    "periodType": "duration",
                                    "balance": None,
                                    "abstract": False,
                                    "substitutionGroup": "xbrli:item",
                                    "labels": {"label": label_val},
                                }

            # 4. Parse Roles / ELRs
            role_files = [n for n in z.namelist() if "role" in n and n.endswith(".xsd")]
            for rname in role_files:
                tree = ET.fromstring(z.read(rname))
                for role in tree.findall(f".//{NS_LINK}roleType"):
                    uri = role.attrib.get("roleURI")
                    def_elem = role.find(f"{NS_LINK}definition")
                    def_text = clean_label(def_elem.text) if def_elem is not None else ""
                    m = re.match(r"\[([0-9]{6}[a-z]?)\]\s*(.*)", def_text)
                    code = m.group(1) if m else uri.split("/")[-1]
                    title = m.group(2) if m else def_text or code
                    group = "Statements" if code.startswith("1001") or code.startswith("1002") else "Schedules"
                    elr_info = {
                        "uri": uri,
                        "code": code,
                        "title": title,
                        "definition": def_text,
                        "group": group,
                    }
                    elrs.append(elr_info)
                    elr_by_uri[uri] = elr_info

            # Sort ELRs by code
            elrs.sort(key=lambda x: str(x.get("code", "")))

            # 5. Parse Presentation Linkbase
            pre_files = [n for n in z.namelist() if "-pre.xml" in n]
            for pname in pre_files:
                tree = ET.fromstring(z.read(pname))
                for link in tree.findall(f".//{NS_LINK}presentationLink"):
                    uri = link.attrib.get(f"{NS_XLINK}role")
                    if not uri:
                        continue
                    locs: Dict[str, str] = {}
                    for loc in link.findall(f".//{NS_LINK}loc"):
                        lbl = loc.attrib.get(f"{NS_XLINK}label")
                        href = loc.attrib.get(f"{NS_XLINK}href", "")
                        cname = href.split("#")[-1].replace("in-cost_", "").replace("in-cost-aud_", "")
                        locs[lbl] = f"in-cost:{cname}"

                    arcs: List[Dict[str, Any]] = []
                    for arc in link.findall(f".//{NS_LINK}presentationArc"):
                        from_k = arc.attrib.get(f"{NS_XLINK}from")
                        to_k = arc.attrib.get(f"{NS_XLINK}to")
                        order = float(arc.attrib.get("order", "1.0"))
                        pref = arc.attrib.get("preferredLabel")
                        from_q = locs.get(from_k)
                        to_q = locs.get(to_k)
                        if from_q and to_q:
                            arcs.append({
                                "from": from_q,
                                "to": to_q,
                                "order": order,
                                "preferredLabel": pref,
                            })
                    arcs.sort(key=lambda a: a["order"])
                    presentation[uri] = arcs

            # 6. Parse Calculation Linkbase
            cal_files = [n for n in z.namelist() if "-cal.xml" in n]
            for cname in cal_files:
                tree = ET.fromstring(z.read(cname))
                for link in tree.findall(f".//{NS_LINK}calculationLink"):
                    uri = link.attrib.get(f"{NS_XLINK}role")
                    if not uri:
                        continue
                    locs: Dict[str, str] = {}
                    for loc in link.findall(f".//{NS_LINK}loc"):
                        lbl = loc.attrib.get(f"{NS_XLINK}label")
                        href = loc.attrib.get(f"{NS_XLINK}href", "")
                        cname = href.split("#")[-1].replace("in-cost_", "").replace("in-cost-aud_", "")
                        locs[lbl] = f"in-cost:{cname}"

                    arcs: List[Dict[str, Any]] = []
                    for arc in link.findall(f".//{NS_LINK}calculationArc"):
                        from_k = arc.attrib.get(f"{NS_XLINK}from")
                        to_k = arc.attrib.get(f"{NS_XLINK}to")
                        order = float(arc.attrib.get("order", "1.0"))
                        weight = float(arc.attrib.get("weight", "1.0"))
                        from_q = locs.get(from_k)
                        to_q = locs.get(to_k)
                        if from_q and to_q:
                            arcs.append({
                                "from": from_q,
                                "to": to_q,
                                "order": order,
                                "weight": weight,
                            })
                    arcs.sort(key=lambda a: a["order"])
                    calculation[uri] = arcs

            # 7. Parse Definition Linkbase (Hypercubes & Defaults)
            def_files = [n for n in z.namelist() if "-def.xml" in n]
            for dname in def_files:
                tree = ET.fromstring(z.read(dname))
                for link in tree.findall(f".//{NS_LINK}definitionLink"):
                    uri = link.attrib.get(f"{NS_XLINK}role")
                    locs: Dict[str, str] = {}
                    for loc in link.findall(f".//{NS_LINK}loc"):
                        lbl = loc.attrib.get(f"{NS_XLINK}label")
                        href = loc.attrib.get(f"{NS_XLINK}href", "")
                        cname = href.split("#")[-1].replace("in-cost_", "").replace("in-cost-aud_", "")
                        locs[lbl] = f"in-cost:{cname}"

                    arcs: List[Dict[str, Any]] = []
                    for arc in link.findall(f".//{NS_LINK}definitionArc"):
                        arcrole = arc.attrib.get(f"{NS_XLINK}arcrole", "").split("/")[-1]
                        from_k = arc.attrib.get(f"{NS_XLINK}from")
                        to_k = arc.attrib.get(f"{NS_XLINK}to")
                        from_q = locs.get(from_k)
                        to_q = locs.get(to_k)
                        if from_q and to_q:
                            if arcrole == "dimension-default":
                                dimension_defaults[from_q] = to_q
                            arcs.append({
                                "arcrole": arcrole,
                                "from": from_q,
                                "to": to_q,
                                "order": float(arc.attrib.get("order", "1.0")),
                            })
                    if uri:
                        definition[uri] = arcs

        # 8. Compile official Costing Business Rules from Excel
        compiled_rules: List[Dict[str, Any]] = []
        if rules_path.exists():
            wb = openpyxl.load_workbook(rules_path, read_only=True)
            # Mandatory line items
            if "Mandatory line item CAR" in wb.sheetnames:
                ws = wb["Mandatory line item CAR"]
                for row in ws.iter_rows(values_only=True):
                    if len(row) >= 3 and row[2] and "Element" not in str(row[2]):
                        prefix = str(row[0] or "in-cost").strip()
                        cname = str(row[2]).strip()
                        label_str = str(row[1] or cname).strip()
                        qname = f"{prefix}:{cname}"
                        compiled_rules.append({
                            "id": f"COST-MANDATORY-{cname}",
                            "status": "EXECUTABLE",
                            "severity": "ERROR",
                            "subject": qname,
                            "text": f"Mandatory line item: {label_str}",
                            "ast": {
                                "type": "mandatory",
                                "concept": qname,
                            },
                        })

        costing_kb = {
            "meta": {
                "name": "MCA Costing Taxonomy 2019 Authority Model",
                "taxonomyType": "costing",
                "taxonomyVersion": "Final Costing Taxonomy 2019 Version 1.1",
                "entryPoint": "in-cost-aud-2018-04-01.xsd",
                "schemaRef": "https://www.mca.gov.in/V3XBRL/2018/04/01/Taxonomy/Costing/in-cost-aud-2018-04-01.xsd",
                "lastRebuilt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            "namespaces": {
                "in-cost": "http://www.icmai.in/xbrl/2018-04-01/in-cost",
                "in-cost-aud": "http://www.icmai.in/xbrl/2018-04-01/in-cost-aud",
            },
            "concepts": concepts,
            "elrs": elrs,
            "presentation": presentation,
            "calculation": calculation,
            "definition": definition,
            "dimensionDefaults": dimension_defaults,
            "tables": tables,
            "businessRules": {"rules": compiled_rules},
        }

        costing_target = self.kb_dir / "costing_knowledge_base.json"
        with open(costing_target, "w", encoding="utf-8") as f:
            json.dump(costing_kb, f, indent=2)

        logger.info(
            "compiler.costing.completed",
            concepts=len(concepts),
            elrs=len(elrs),
            rules=len(compiled_rules),
        )
        return costing_target

    # =========================================================================
    # 3. IND-AS TAXONOMY V1.2
    # =========================================================================
    def compile_ind_as(self) -> Path:
        """Extracts and compiles Ind AS V1.2 into ind_as_knowledge_base.json."""
        logger.info("compiler.ind_as.starting")
        base_dir = (
            DATA_DIR
            / "IND-AS taxonomy"
            / "Taxonomy for IND-AS V1.2@31-03-2017"
            / "Ind AS taxonomy"
            / "Ind AS taxonomy"
        )
        rules_path = (
            DATA_DIR
            / "IND-AS taxonomy"
            / "buisness_rules"
            / "BusinessRulesforIndASTaxonomyV1.2@-"
            / "Business Rules for IndAS Taxonomy V1.2.xlsx"
        )

        concepts: Dict[str, Dict[str, Any]] = {}
        elrs: List[Dict[str, Any]] = []
        presentation: Dict[str, List[Dict[str, Any]]] = {}
        calculation: Dict[str, List[Dict[str, Any]]] = {}
        definition: Dict[str, List[Dict[str, Any]]] = {}
        dimension_defaults: Dict[str, str] = {}
        tables: List[Dict[str, Any]] = []

        if not base_dir.exists():
            raise FileNotFoundError(f"Missing Ind AS base folder at {base_dir}")

        # 1. Parse Ind AS & In-CA Schema files
        for xsd_file in base_dir.rglob("*.xsd"):
            if "role" in xsd_file.name or "type" in xsd_file.name:
                continue
            try:
                tree = ET.parse(xsd_file)
                root = tree.getroot()
                prefix = "in-ca" if "in-ca" in xsd_file.name else "ind-as"
                for elem in root.findall(f".//{NS_XS}element"):
                    name = elem.attrib.get("name")
                    if not name:
                        continue
                    qname = f"{prefix}:{name}"
                    concepts[qname] = {
                        "qname": qname,
                        "name": name,
                        "type": elem.attrib.get("type", "xbrli:stringItemType"),
                        "periodType": elem.attrib.get(f"{{{NS_XBRLI}}}periodType", "duration"),
                        "balance": elem.attrib.get(f"{{{NS_XBRLI}}}balance"),
                        "abstract": elem.attrib.get("abstract") == "true",
                        "substitutionGroup": elem.attrib.get("substitutionGroup", "xbrli:item"),
                        "labels": {},
                    }
            except Exception as e:
                logger.warning("compiler.ind_as.schema_error", file=xsd_file.name, error=str(e))

        # 2. Parse all label linkbases
        for lab_file in base_dir.rglob("*lab*.xml"):
            try:
                tree = ET.parse(lab_file)
                root = tree.getroot()
                prefix = "in-ca" if "in-ca" in lab_file.name else "ind-as"
                locators: Dict[str, str] = {}
                for loc in root.findall(f".//{NS_LINK}loc"):
                    lbl = loc.attrib.get(f"{NS_XLINK}label")
                    href = loc.attrib.get(f"{NS_XLINK}href", "")
                    cname = href.split("#")[-1].replace("in-ca_", "").replace("ind-as_", "")
                    locators[lbl] = f"{prefix}:{cname}"

                labels_dict: Dict[str, str] = {}
                for lbl in root.findall(f".//{NS_LINK}label"):
                    k = lbl.attrib.get(f"{NS_XLINK}label")
                    labels_dict[k] = clean_label(lbl.text)

                for arc in root.findall(f".//{NS_LINK}labelArc"):
                    from_k = arc.attrib.get(f"{NS_XLINK}from")
                    to_k = arc.attrib.get(f"{NS_XLINK}to")
                    qname = locators.get(from_k)
                    text = labels_dict.get(to_k)
                    if qname and text and qname in concepts:
                        concepts[qname]["labels"]["label"] = text
            except Exception as e:
                logger.warning("compiler.ind_as.label_error", file=lab_file.name, error=str(e))

        # 3. Parse Roles / ELRs
        role_files = list(base_dir.rglob("*roles*.xsd"))
        for rf in role_files:
            try:
                tree = ET.parse(rf)
                root = tree.getroot()
                for role in root.findall(f".//{NS_LINK}roleType"):
                    uri = role.attrib.get("roleURI")
                    def_elem = role.find(f"{NS_LINK}definition")
                    def_text = clean_label(def_elem.text) if def_elem is not None else ""
                    m = re.match(r"\[([0-9]{6}[a-z]?)\]\s*(.*)", def_text)
                    code = m.group(1) if m else uri.split("/")[-1]
                    title = m.group(2) if m else def_text or code
                    group = "Statements" if code.startswith("1") or code.startswith("2") or code.startswith("3") else "Notes"
                    elrs.append({
                        "uri": uri,
                        "code": code,
                        "title": title,
                        "definition": def_text,
                        "group": group,
                    })
            except Exception as e:
                logger.warning("compiler.ind_as.role_error", file=rf.name, error=str(e))

        elrs.sort(key=lambda x: str(x.get("code", "")))

        # 4. Parse Presentation Linkbases
        for pre_file in base_dir.rglob("*-pre-*.xml"):
            try:
                tree = ET.parse(pre_file)
                root = tree.getroot()
                prefix = "in-ca" if "in-ca" in pre_file.name else "ind-as"
                for link in root.findall(f".//{NS_LINK}presentationLink"):
                    uri = link.attrib.get(f"{NS_XLINK}role")
                    if not uri:
                        continue
                    locs: Dict[str, str] = {}
                    for loc in link.findall(f".//{NS_LINK}loc"):
                        lbl = loc.attrib.get(f"{NS_XLINK}label")
                        href = loc.attrib.get(f"{NS_XLINK}href", "")
                        cname = href.split("#")[-1].replace("in-ca_", "").replace("ind-as_", "")
                        locs[lbl] = f"{prefix}:{cname}"

                    arcs: List[Dict[str, Any]] = []
                    for arc in link.findall(f".//{NS_LINK}presentationArc"):
                        from_k = arc.attrib.get(f"{NS_XLINK}from")
                        to_k = arc.attrib.get(f"{NS_XLINK}to")
                        order = float(arc.attrib.get("order", "1.0"))
                        pref = arc.attrib.get("preferredLabel")
                        from_q = locs.get(from_k)
                        to_q = locs.get(to_k)
                        if from_q and to_q:
                            arcs.append({
                                "from": from_q,
                                "to": to_q,
                                "order": order,
                                "preferredLabel": pref,
                            })
                    arcs.sort(key=lambda a: a["order"])
                    presentation[uri] = arcs
            except Exception as e:
                logger.warning("compiler.ind_as.pre_error", file=pre_file.name, error=str(e))

        # 5. Parse Calculation Linkbases
        for cal_file in base_dir.rglob("*-cal-*.xml"):
            try:
                tree = ET.parse(cal_file)
                root = tree.getroot()
                prefix = "in-ca" if "in-ca" in cal_file.name else "ind-as"
                for link in root.findall(f".//{NS_LINK}calculationLink"):
                    uri = link.attrib.get(f"{NS_XLINK}role")
                    if not uri:
                        continue
                    locs: Dict[str, str] = {}
                    for loc in link.findall(f".//{NS_LINK}loc"):
                        lbl = loc.attrib.get(f"{NS_XLINK}label")
                        href = loc.attrib.get(f"{NS_XLINK}href", "")
                        cname = href.split("#")[-1].replace("in-ca_", "").replace("ind-as_", "")
                        locs[lbl] = f"{prefix}:{cname}"

                    arcs: List[Dict[str, Any]] = []
                    for arc in link.findall(f".//{NS_LINK}calculationArc"):
                        from_k = arc.attrib.get(f"{NS_XLINK}from")
                        to_k = arc.attrib.get(f"{NS_XLINK}to")
                        order = float(arc.attrib.get("order", "1.0"))
                        weight = float(arc.attrib.get("weight", "1.0"))
                        from_q = locs.get(from_k)
                        to_q = locs.get(to_k)
                        if from_q and to_q:
                            arcs.append({
                                "from": from_q,
                                "to": to_q,
                                "order": order,
                                "weight": weight,
                            })
                    arcs.sort(key=lambda a: a["order"])
                    calculation[uri] = arcs
            except Exception as e:
                logger.warning("compiler.ind_as.cal_error", file=cal_file.name, error=str(e))

        # 6. Parse Definition Linkbases
        for def_file in base_dir.rglob("*-def-*.xml"):
            try:
                tree = ET.parse(def_file)
                root = tree.getroot()
                prefix = "in-ca" if "in-ca" in def_file.name else "ind-as"
                for link in root.findall(f".//{NS_LINK}definitionLink"):
                    uri = link.attrib.get(f"{NS_XLINK}role")
                    locs: Dict[str, str] = {}
                    for loc in link.findall(f".//{NS_LINK}loc"):
                        lbl = loc.attrib.get(f"{NS_XLINK}label")
                        href = loc.attrib.get(f"{NS_XLINK}href", "")
                        cname = href.split("#")[-1].replace("in-ca_", "").replace("ind-as_", "")
                        locs[lbl] = f"{prefix}:{cname}"

                    arcs: List[Dict[str, Any]] = []
                    for arc in link.findall(f".//{NS_LINK}definitionArc"):
                        arcrole = arc.attrib.get(f"{NS_XLINK}arcrole", "").split("/")[-1]
                        from_k = arc.attrib.get(f"{NS_XLINK}from")
                        to_k = arc.attrib.get(f"{NS_XLINK}to")
                        from_q = locs.get(from_k)
                        to_q = locs.get(to_k)
                        if from_q and to_q:
                            if arcrole == "dimension-default":
                                dimension_defaults[from_q] = to_q
                            arcs.append({
                                "arcrole": arcrole,
                                "from": from_q,
                                "to": to_q,
                                "order": float(arc.attrib.get("order", "1.0")),
                            })
                    if uri:
                        definition[uri] = arcs
            except Exception as e:
                logger.warning("compiler.ind_as.def_error", file=def_file.name, error=str(e))

        # 7. Compile Ind AS Business Rules from Excel
        compiled_rules: List[Dict[str, Any]] = []
        if rules_path.exists():
            wb = openpyxl.load_workbook(rules_path, read_only=True)
            if "Mandatory Line Items" in wb.sheetnames:
                ws = wb["Mandatory Line Items"]
                for row in ws.iter_rows(values_only=True):
                    if len(row) >= 4 and row[2] and "Element" not in str(row[2]):
                        prefix = str(row[0] or "ind-as").strip()
                        cname = str(row[2]).strip()
                        label_str = str(row[1] or cname).strip()
                        qname = f"{prefix}:{cname}"
                        compiled_rules.append({
                            "id": f"INDAS-MANDATORY-{cname}",
                            "status": "EXECUTABLE",
                            "severity": "ERROR",
                            "subject": qname,
                            "text": f"Mandatory field: {label_str}",
                            "ast": {
                                "type": "mandatory",
                                "concept": qname,
                            },
                        })

        ind_as_kb = {
            "meta": {
                "name": "MCA Ind AS Taxonomy V1.2 Authority Model",
                "taxonomyType": "ind_as",
                "taxonomyVersion": "Taxonomy for IND-AS V1.2 31-03-2017",
                "entryPoint": "in-ca-ent-2017-03-31.xsd",
                "schemaRef": "https://www.mca.gov.in/V3XBRL/2017/03/31/Taxonomy/IndAS/in-ci-ent-2017-03-31.xsd",
                "lastRebuilt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            "namespaces": {
                "in-ca": "http://www.icai.org/xbrl/taxonomy/2017-03-31/in-ca",
                "ind-as": "http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as",
            },
            "concepts": concepts,
            "elrs": elrs,
            "presentation": presentation,
            "calculation": calculation,
            "definition": definition,
            "dimensionDefaults": dimension_defaults,
            "tables": tables,
            "businessRules": {"rules": compiled_rules},
        }

        ind_as_target = self.kb_dir / "ind_as_knowledge_base.json"
        with open(ind_as_target, "w", encoding="utf-8") as f:
            json.dump(ind_as_kb, f, indent=2)

        logger.info(
            "compiler.ind_as.completed",
            concepts=len(concepts),
            elrs=len(elrs),
            rules=len(compiled_rules),
        )
        return ind_as_target

    def run_all(self):
        """Compiles all three taxonomies."""
        print("=" * 70)
        print("COMPILING STANDARDIZED TAXONOMY KNOWLEDGE BASES")
        print("=" * 70)
        ci_path = self.compile_ci()
        print(f"  ✅ C&I 2016 Knowledge Base: {ci_path.name}")
        cost_path = self.compile_costing()
        print(f"  ✅ Costing 2019 Knowledge Base: {cost_path.name}")
        ind_path = self.compile_ind_as()
        print(f"  ✅ Ind AS V1.2 Knowledge Base: {ind_path.name}")
        print("=" * 70)


def main():
    compiler = TaxonomyCompiler()
    compiler.run_all()


if __name__ == "__main__":
    main()
