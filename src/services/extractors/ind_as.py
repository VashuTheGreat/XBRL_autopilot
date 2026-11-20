import json
from pathlib import Path
import xml.etree.ElementTree as ET
from python_calamine import CalamineWorkbook
from src.constants import (
    INDAS_TAXONOMY_DIR_PATH,
    INDAS_RULES_EXCEL_PATH,
    INDAS_OUTPUT_JSON_PATH
)
from src.utils.main_utils import save_json
from src.core.logger import logger


class IndASTaxonomyEngine:
    """Master Engine which reads MCA rules and all and finally generates a unified json"""

    def __init__(self, taxonomy_dir: Path, rules_excel_path: Path):
        self.tax_dir = taxonomy_dir
        self.rules_path = rules_excel_path
        self.concepts = {}
        self.id_to_qname = {}
        self.presentation = {}
        self.calculation = {}
        self.definition = {}
        self.rules = {}

    @staticmethod
    def clean_tag(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    @staticmethod
    def get_clean_attrib(el: ET.Element, attr_name: str):
        for k, v in el.attrib.items():
            if IndASTaxonomyEngine.clean_tag(k) == attr_name:
                return v
        return None

    def parse_schemas(self):
        """Step 1: Parse Concepts from all .xsd files"""
        logger.info("indas_engine.parsing_schemas")
        for xsd in sorted(self.tax_dir.rglob("*.xsd")):
            prefix = "in-ca" if "in-ca" in xsd.name else ("ind-as" if "ind-as" in xsd.name else None)
            if not prefix:
                continue
            tree = ET.parse(xsd)
            for el in tree.getroot().iter():
                if self.clean_tag(el.tag) == "element":
                    name = el.attrib.get("name")
                    if not name:
                        continue
                    qname = f"{prefix}:{name}"
                    elem_id = el.attrib.get("id")
                    self.concepts[qname] = {
                        "qname": qname,
                        "name": name,
                        "prefix": prefix,
                        "type": el.attrib.get("type", "").split(":")[-1],
                        "periodType": self.get_clean_attrib(el, "periodType"),
                        "balance": self.get_clean_attrib(el, "balance"),
                        "abstract": el.attrib.get("abstract") == "true",
                        "labels": {},
                    }
                    if elem_id:
                        self.id_to_qname[elem_id] = qname
                        self.id_to_qname[f"{xsd.name}#{elem_id}"] = qname
        logger.info("indas_engine.schemas_parsed", total_concepts=len(self.concepts))

    def parse_labels(self):
        """Step 2: Merge English and Hindi labels from *lab*.xml"""
        logger.info("indas_engine.parsing_labels")
        for lab in sorted(self.tax_dir.rglob("*lab*.xml")):
            tree = ET.parse(lab)
            root = tree.getroot()
            loc_map = {}
            for el in root.iter():
                if self.clean_tag(el.tag) == "loc":
                    l_id = self.get_clean_attrib(el, "label")
                    frag = (self.get_clean_attrib(el, "href") or "").split("#")[-1]
                    qn = self.id_to_qname.get(frag) or self.id_to_qname.get(frag.replace("_", ":"))
                    if qn:
                        loc_map[l_id] = qn
            text_map = {}
            for el in root.iter():
                if self.clean_tag(el.tag) == "label":
                    l_id = self.get_clean_attrib(el, "label")
                    lang = self.get_clean_attrib(el, "lang") or "en"
                    text_map[l_id] = ((el.text or "").strip(), lang)
            for el in root.iter():
                if self.clean_tag(el.tag) == "labelArc":
                    f = loc_map.get(self.get_clean_attrib(el, "from"))
                    t = self.get_clean_attrib(el, "to")
                    if f and t in text_map and f in self.concepts:
                        txt, lang = text_map[t]
                        if lang == "hi":
                            self.concepts[f]["labels"]["label_hi"] = txt
                        else:
                            self.concepts[f]["labels"]["label"] = txt

    def parse_presentation(self):
        """Step 3: Parse Presentation Trees from *pre*.xml"""
        logger.info("indas_engine.parsing_presentation")
        for pre in sorted(self.tax_dir.rglob("*pre*.xml")):
            tree = ET.parse(pre)
            root = tree.getroot()
            for link in root.iter():
                if self.clean_tag(link.tag) != "presentationLink":
                    continue
                role = self.get_clean_attrib(link, "role") or ""
                elr = role.split("_")[-1] if "_" in role else role.split("/")[-1]
                locs = {
                    self.get_clean_attrib(e, "label"): (
                        self.id_to_qname.get((self.get_clean_attrib(e, "href") or "").split("#")[-1])
                        or (self.get_clean_attrib(e, "href") or "").split("#")[-1]
                    )
                    for e in link.iter()
                    if self.clean_tag(e.tag) == "loc"
                }
                for arc in link.iter():
                    if self.clean_tag(arc.tag) == "presentationArc":
                        f = locs.get(self.get_clean_attrib(arc, "from"))
                        t = locs.get(self.get_clean_attrib(arc, "to"))
                        order = float(self.get_clean_attrib(arc, "order") or "1.0")
                        if f and t:
                            self.presentation.setdefault(elr, []).append({
                                "from": f,
                                "to": t,
                                "order": int(order) if order.is_integer() else order,
                            })
        logger.info("indas_engine.presentation_parsed", elrs_count=len(self.presentation))

    def parse_calculation(self):
        """Step 4: Parse Calculation Equations from *cal*.xml"""
        logger.info("indas_engine.parsing_calculation")
        for cal in sorted(self.tax_dir.rglob("*cal*.xml")):
            tree = ET.parse(cal)
            root = tree.getroot()
            for link in root.iter():
                if self.clean_tag(link.tag) != "calculationLink":
                    continue
                role = self.get_clean_attrib(link, "role") or ""
                elr = role.split("_")[-1] if "_" in role else role.split("/")[-1]
                locs = {
                    self.get_clean_attrib(e, "label"): (
                        self.id_to_qname.get((self.get_clean_attrib(e, "href") or "").split("#")[-1])
                        or (self.get_clean_attrib(e, "href") or "").split("#")[-1]
                    )
                    for e in link.iter()
                    if self.clean_tag(e.tag) == "loc"
                }
                for arc in link.iter():
                    if self.clean_tag(arc.tag) == "calculationArc":
                        f = locs.get(self.get_clean_attrib(arc, "from"))
                        t = locs.get(self.get_clean_attrib(arc, "to"))
                        w = float(self.get_clean_attrib(arc, "weight") or "1.0")
                        order = float(self.get_clean_attrib(arc, "order") or "1.0")
                        if f and t:
                            self.calculation.setdefault(elr, []).append({
                                "from": f,
                                "to": t,
                                "weight": int(w) if w.is_integer() else w,
                                "order": int(order) if order.is_integer() else order,
                            })
        logger.info("indas_engine.calculation_parsed", elrs_count=len(self.calculation))

    def parse_definition(self):
        """Step 5: Parse Definition/Dimensional Linkbases from *def*.xml"""
        logger.info("indas_engine.parsing_definition")
        for def_file in sorted(self.tax_dir.rglob("*def*.xml")):
            tree = ET.parse(def_file)
            root = tree.getroot()
            for link in root.iter():
                if self.clean_tag(link.tag) != "definitionLink":
                    continue
                role_uri = self.get_clean_attrib(link, "role") or ""
                elr_code = role_uri.split("_")[-1] if "_" in role_uri else role_uri.split("/")[-1]
                locs = {
                    self.get_clean_attrib(e, "label"): (
                        self.id_to_qname.get((self.get_clean_attrib(e, "href") or "").split("#")[-1])
                        or (self.get_clean_attrib(e, "href") or "").split("#")[-1]
                    )
                    for e in link.iter()
                    if self.clean_tag(e.tag) == "loc"
                }
                for arc in link.iter():
                    if self.clean_tag(arc.tag) == "definitionArc":
                        arcrole = (self.get_clean_attrib(arc, "arcrole") or "").split("/")[-1]
                        from_concept = locs.get(self.get_clean_attrib(arc, "from"))
                        to_concept = locs.get(self.get_clean_attrib(arc, "to"))
                        order = float(self.get_clean_attrib(arc, "order") or "1.0")
                        if from_concept and to_concept:
                            self.definition.setdefault(elr_code, []).append({
                                "arcrole": arcrole,
                                "from": from_concept,
                                "to": to_concept,
                                "order": int(order) if order.is_integer() else order,
                            })
        logger.info("indas_engine.definition_parsed", elrs_count=len(self.definition))

    def parse_business_rules(self):
        """Step 6: Parse MCA Business Rules from Excel (Mandatory, Non-Negative, ELR groupings)"""
        logger.info("indas_engine.parsing_business_rules")
        wb = CalamineWorkbook.from_path(self.rules_path)
        sheet = next(s for s in wb.sheet_names if "specific" in s.lower())
        rows = wb.get_sheet_by_name(sheet).to_python()
        name_map = {c["name"].lower(): qn for qn, c in self.concepts.items()}

        mandatory, conditional, consolidated, non_negative = [], [], [], []
        mandatory_by_elr = {}
        current_elr_code = None

        for r in rows:
            if len(r) > 1 and r[0] == "Definition" and r[1]:
                text = str(r[1])
                if "[" in text and "]" in text:
                    current_elr_code = text.split("[")[1].split("]")[0]
                else:
                    current_elr_code = text
            elif len(r) > 5 and r[1] and r[5]:
                name = str(r[1]).strip()
                rule = str(r[5]).strip()
                rule_lower = rule.lower()
                if rule == "Business Rule":
                    continue

                qn = name_map.get(name.lower())
                if not qn and r[0]:
                    test_qn = f"{r[0]}:{name}"
                    if test_qn in self.concepts:
                        qn = test_qn
                if not qn:
                    continue

                # Rule 1: Non-Negative check directly from MCA rules
                if "greater than" in rule_lower and "zero" in rule_lower:
                    if qn not in non_negative:
                        non_negative.append(qn)
                        self.concepts[qn]["isNonNegative"] = True

                # Rule 2: Mandatory rules & ELR classification
                if "mandatory in case of consolidated" in rule_lower:
                    if qn not in consolidated:
                        consolidated.append(qn)
                        self.concepts[qn]["isMandatoryConsolidated"] = True
                elif "mandatory field" in rule_lower or "this is a mandatory field" in rule_lower or "mandatory element" in rule_lower or "all details" in rule_lower:
                    if qn not in mandatory:
                        mandatory.append(qn)
                        self.concepts[qn]["isMandatory"] = True
                    if current_elr_code:
                        mandatory_by_elr.setdefault(current_elr_code, [])
                        if qn not in mandatory_by_elr[current_elr_code]:
                            mandatory_by_elr[current_elr_code].append(qn)
                elif "mandatory if" in rule_lower:
                    if qn not in conditional:
                        conditional.append(qn)
                        self.concepts[qn]["isMandatoryConditional"] = True

        self.rules = {
            "mandatoryConcepts": mandatory,
            "mandatoryByELR": mandatory_by_elr,
            "nonNegativeConcepts": non_negative,
            "conditionalMandatory": conditional,
            "mandatoryConsolidated": consolidated,
        }
        logger.info(
            "indas_engine.business_rules_parsed",
            mandatory_count=len(mandatory),
            non_negative_count=len(non_negative),
            conditional_count=len(conditional),
            consolidated_count=len(consolidated),
        )

    def build(self) -> dict:
        """Master builder executing all steps in sequence."""
        with logger.span("indas_engine.build"):
            self.parse_schemas()
            self.parse_labels()
            self.parse_presentation()
            self.parse_calculation()
            self.parse_definition()
            self.parse_business_rules()

            final_kb = {
                "meta": {
                    "taxonomy": "ind_as",
                    "totalConcepts": len(self.concepts),
                    "totalPresentationELRs": len(self.presentation),
                    "totalCalculationELRs": len(self.calculation),
                    "totalDefinitionELRs": len(self.definition),
                    "totalMandatoryConcepts": len(self.rules["mandatoryConcepts"]),
                    "totalNonNegativeConcepts": len(self.rules["nonNegativeConcepts"]),
                    "totalConditionalMandatory": len(self.rules["conditionalMandatory"]),
                    "totalConsolidatedMandatory": len(self.rules["mandatoryConsolidated"]),
                },
                "concepts": self.concepts,
                "presentation": self.presentation,
                "calculation": self.calculation,
                "definition": self.definition,
                "businessRules": self.rules,
            }
            logger.info("indas_engine.build_completed", meta=final_kb["meta"])
            return final_kb


async def main():
    with logger.span("indas_extractor.main"):
        engine = IndASTaxonomyEngine(taxonomy_dir=INDAS_TAXONOMY_DIR_PATH, rules_excel_path=INDAS_RULES_EXCEL_PATH)
        complete_kb_json = engine.build()
        # Save to disk
        logger.info("indas_extractor.saving_knowledge_base", path=str(INDAS_OUTPUT_JSON_PATH))
        await save_json(path=INDAS_OUTPUT_JSON_PATH, data=complete_kb_json)
        logger.info("indas_extractor.saved_successfully", path=str(INDAS_OUTPUT_JSON_PATH), summary=complete_kb_json["meta"])

