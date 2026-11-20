import json
import os
import re
import html
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Any, Tuple
from src.constants import BASE_DIR, INDAS_OUTPUT_JSON_PATH, OUTPUT_DIR
from src.core.logger import logger
from .base import Pipeline
from src.utils.main_utils import save_xml, load_xml



class IndASValidator:
    """Production Validator executing statutory MCA rules directly from ind_as_knowledge_base.json.
    
    ZERO HARDCODING:
    - No hardcoded concept lists
    - No hardcoded exempt_negative set
    - Mandatory fields, non-negative concepts, and calculation trees are 100% dynamic.
    """

    def __init__(self, kb_path: Path | str):
        """Accepts path to the Knowledge Base JSON and extracts all statutory rules dynamically."""
        self.kb_path = Path(kb_path)
        if not self.kb_path.exists():
            raise FileNotFoundError(f"Knowledge Base JSON not found at: {self.kb_path}")

        with open(self.kb_path, "r", encoding="utf-8") as f:
            self.kb = json.load(f)

        self.concepts = self.kb.get("concepts", {})
        self.calculation = self.kb.get("calculation", {})
        self.business_rules = self.kb.get("businessRules", {})

        # Dynamically extracted from KB - NO HARDCODING
        self.mandatory_concepts = set(self.business_rules.get("mandatoryConcepts", []))
        self.mandatory_by_elr = self.business_rules.get("mandatoryByELR", {})
        self.non_negative_concepts = set(self.business_rules.get("nonNegativeConcepts", []))
        logger.info(
            "xml_validator.initialized",
            concepts=len(self.concepts),
            mandatory=len(self.mandatory_concepts),
            non_negative=len(self.non_negative_concepts),
        )

    def validate(self, payload: Dict[str, Any]) -> Tuple[bool, List[Dict[str, Any]]]:
        """Validates filing payload dynamically against KB rules. Returns (is_valid, errors)."""
        errors = []

        # -------------------------------------------------------------
        # 1. Flatten Facts (CY & PY)
        # -------------------------------------------------------------
        facts_cy: Dict[str, Any] = {}
        facts_py: Dict[str, Any] = {}

        # Master Company & Auditor facts
        for k, v in payload.get("master", {}).get("company", {}).items():
            facts_cy[k] = v
        for k, v in payload.get("master", {}).get("auditor", {}).items():
            facts_cy[k] = v

        # Statement line items (Pure concept, cy, py - NO noteNo needed)
        statements = payload.get("statements", {})
        for st_name, rows in statements.items():
            for row in rows:
                concept = row.get("concept")
                if not concept:
                    continue
                if "cy" in row and row["cy"] is not None:
                    facts_cy[concept] = row["cy"]
                if "py" in row and row["py"] is not None:
                    facts_py[concept] = row["py"]

        # Notes facts (text blocks)
        for note in payload.get("notes", []):
            concept = note.get("concept")
            if concept and note.get("content"):
                facts_cy[concept] = note["content"]

        # -------------------------------------------------------------
        # 2. Gate 1: Dynamic Mandatory Company Information (ELR 700300)
        # -------------------------------------------------------------
        company_mandatory = self.mandatory_by_elr.get("700300", [])
        for qn in company_mandatory:
            if qn not in facts_cy or not str(facts_cy[qn]).strip():
                concept_name = self.concepts.get(qn, {}).get("name", qn)
                errors.append({
                    "level": "ERROR",
                    "type": "MANDATORY_COMPANY_INFO_MISSING",
                    "concept": qn,
                    "message": f"Mandatory company identification field missing: {concept_name} ({qn})"
                })

        # -------------------------------------------------------------
        # 3. Gate 2: Statutory Signatories & Auditor Checks
        # -------------------------------------------------------------
        # Minimum 2 Director signatories required under Section 134(1) of Companies Act
        signatories = payload.get("master", {}).get("signatories", [])
        if len(signatories) < 2:
            errors.append({
                "level": "ERROR",
                "type": "INSUFFICIENT_SIGNATORIES",
                "message": f"Minimum 2 Director signatories required for AOC-4. Found: {len(signatories)}"
            })
        for idx, d in enumerate(signatories, 1):
            din = str(d.get("din", "")).strip()
            if not din or len(din) != 8 or not din.isdigit():
                errors.append({
                    "level": "ERROR",
                    "type": "INVALID_DIN",
                    "message": f"Signatory {idx}: Invalid 8-digit DIN ({d.get('din')})"
                })

        # -------------------------------------------------------------
        # 4. Gate 3: Dynamic Mandatory Statement Roots Check
        # -------------------------------------------------------------
        # Automatically discover the root concepts of statement calculation trees
        for elr in ["110000", "210000"]:
            eqs = self.calculation.get(elr, [])
            if eqs:
                parents = {eq["from"] for eq in eqs}
                children = {eq["to"] for eq in eqs}
                roots = parents - children
                for root_qn in roots:
                    # Ignore per-share metrics from fatal root check
                    if "earningslosspershare" in root_qn.lower():
                        continue
                    if root_qn not in facts_cy:
                        root_name = self.concepts.get(root_qn, {}).get("name", root_qn)
                        errors.append({
                            "level": "ERROR",
                            "type": "MANDATORY_STATEMENT_ROOT_MISSING",
                            "elr": elr,
                            "concept": root_qn,
                            "message": f"Mandatory financial statement root missing for ELR {elr}: {root_name} ({root_qn})"
                        })

        # -------------------------------------------------------------
        # 5. Gate 4: Dynamic Calculation & Math Summation Integrity
        # -------------------------------------------------------------
        # Evaluates sum(child * weight) == parent across all 37 calculation ELRs
        for elr, equations in self.calculation.items():
            parents: Dict[str, List[Dict[str, Any]]] = {}
            for eq in equations:
                parents.setdefault(eq["from"], []).append(eq)

            for parent_qname, children in parents.items():
                if parent_qname in facts_cy and isinstance(facts_cy[parent_qname], (int, float)):
                    expected = facts_cy[parent_qname]
                    present_children = [
                        ch for ch in children 
                        if ch["to"] in facts_cy and isinstance(facts_cy[ch["to"]], (int, float))
                    ]
                    if present_children:
                        calc_sum = sum(facts_cy[ch["to"]] * ch["weight"] for ch in present_children)
                        diff = round(expected - calc_sum, 2)
                        if abs(diff) > 1.0:  # MCA 1 INR rounding tolerance
                            parent_lbl = self.concepts.get(parent_qname, {}).get("name", parent_qname)
                            errors.append({
                                "level": "ERROR",
                                "type": "CALCULATION_MISMATCH",
                                "elr": elr,
                                "parent": parent_qname,
                                "expected": expected,
                                "calculated": calc_sum,
                                "diff": diff,
                                "message": f"Math mismatch in ELR {elr}: {parent_lbl} ({expected:,}) != sum of children ({calc_sum:,}) [Diff: {diff:,}]"
                            })

        # -------------------------------------------------------------
        # 6. Gate 5: Dynamic Balance Sheet Hard Balancing Check
        # -------------------------------------------------------------
        # Discovers debit and credit roots of ELR 110000 dynamically
        eqs_bs = self.calculation.get("110000", [])
        if eqs_bs:
            parents_bs = {eq["from"] for eq in eqs_bs}
            children_bs = {eq["to"] for eq in eqs_bs}
            roots_bs = parents_bs - children_bs
            debit_root = next(
                (r for r in roots_bs if self.concepts.get(r, {}).get("balance") == "debit" or "assets" in r.lower()), 
                None
            )
            credit_root = next(
                (r for r in roots_bs if self.concepts.get(r, {}).get("balance") == "credit" or "equity" in r.lower()), 
                None
            )
            if debit_root and credit_root and debit_root in facts_cy and credit_root in facts_cy:
                total_assets = facts_cy[debit_root]
                total_eq_liab = facts_cy[credit_root]
                bs_diff = round(total_assets - total_eq_liab, 2)
                if abs(bs_diff) > 1.0:
                    errors.append({
                        "level": "CRITICAL",
                        "type": "BS_OUT_OF_BALANCE",
                        "assets": total_assets,
                        "equityAndLiabilities": total_eq_liab,
                        "diff": bs_diff,
                        "message": f"Balance Sheet is out of balance! Total Assets ({total_assets:,}) != Total Equity and Liabilities ({total_eq_liab:,}) [Diff: {bs_diff:,}]"
                    })

        # -------------------------------------------------------------
        # 7. Gate 6: Dynamic Non-Negative Constraints (From MCA Rules)
        # -------------------------------------------------------------
        # Checked against all 211 concepts marked 'Should be greater than or equal to zero' in MCA rules
        # Zero hardcoded exempt_negative list needed!
        for qname, val in facts_cy.items():
            if qname in self.non_negative_concepts:
                if isinstance(val, (int, float)) and val < 0:
                    lbl = self.concepts.get(qname, {}).get("name", qname)
                    errors.append({
                        "level": "ERROR",
                        "type": "NEGATIVE_VALUE_NOT_PERMITTED",
                        "concept": qname,
                        "value": val,
                        "message": f"MCA statutory rule violation: {lbl} ({qname}) cannot be negative (reported: {val:,})"
                    })

        # -------------------------------------------------------------
        # 8. Gate 7: PPE 2D Multi-dimensional Table Schedule Reconciliations
        # -------------------------------------------------------------
        for table in payload.get("tables", []):
            if "PropertyPlantAndEquipment" in table.get("table", ""):
                for row in table.get("rows", []):
                    member = row.get("member", "Unknown")
                    # Gross Rollforward: Gross Opening + Additions - Disposals == Gross Closing
                    g_open = row.get("grossOpening", 0)
                    g_add = row.get("grossAdditions", 0)
                    g_disp = row.get("grossDisposals", 0)
                    g_close = row.get("grossClosing", 0)
                    if g_open + g_add - g_disp != g_close:
                        errors.append({
                            "level": "ERROR",
                            "type": "PPE_GROSS_ROLLFORWARD_MISMATCH",
                            "member": member,
                            "message": f"PPE Rollforward error for {member}: Gross Opening ({g_open:,}) + Additions ({g_add:,}) - Disposals ({g_disp:,}) != Closing ({g_close:,})"
                        })

                    # Dep Rollforward: Dep Opening + For Year - Disposals == Dep Closing
                    d_open = row.get("depOpening", 0)
                    d_year = row.get("depForYear", 0)
                    d_disp = row.get("depDisposals", 0)
                    d_close = row.get("depClosing", 0)
                    if d_open + d_year - d_disp != d_close:
                        errors.append({
                            "level": "ERROR",
                            "type": "PPE_DEP_ROLLFORWARD_MISMATCH",
                            "member": member,
                            "message": f"PPE Depreciation error for {member}: Dep Opening ({d_open:,}) + For Year ({d_year:,}) - Disposals ({d_disp:,}) != Closing ({d_close:,})"
                        })

                    # Net Block: Net CY == Gross Closing - Dep Closing
                    net_cy = row.get("netCurrentYear", 0)
                    if g_close - d_close != net_cy:
                        errors.append({
                            "level": "ERROR",
                            "type": "PPE_NET_BLOCK_MISMATCH",
                            "member": member,
                            "message": f"PPE Net Block error for {member}: Gross Closing ({g_close:,}) - Dep Closing ({d_close:,}) != Net CY ({net_cy:,})"
                        })

        is_valid = len([e for e in errors if e["level"] in ("ERROR", "CRITICAL")]) == 0
        if is_valid:
            logger.info("xml_validator.validation_passed", facts_cy=len(facts_cy), facts_py=len(facts_py))
        else:
            logger.warning("xml_validator.validation_failed", error_count=len(errors))
        return is_valid, errors


class XbrlXmlGenerator:
    """Compiles validated JSON payload into standard MCA AOC-4 XBRL instance document."""

    def __init__(self, payload: Dict[str, Any]):
        self.payload = payload
        self.meta = payload.get("meta", {})
        self.master = payload.get("master", {})
        self.statements = payload.get("statements", {})
        self.tables = payload.get("tables", {})
        self.notes = payload.get("notes", [])
        self.cin = self.master.get("company", {}).get("in-ca:CorporateIdentityNumber", "UNKNOWN_CIN")
        self.start_date = self.meta.get("startDate", "2025-04-01")
        self.end_date = self.meta.get("endDate", "2026-03-31")
        # Prior year dates
        s_year = int(self.start_date.split("-")[0]) - 1
        e_year = int(self.end_date.split("-")[0]) - 1
        self.py_start_date = f"{s_year}-04-01"
        self.py_end_date = f"{e_year}-03-31"

    def build(self) -> str:
        with logger.span("xbrl_generator.build", cin=self.cin):
            result = self._build_xml()
            logger.info("xbrl_generator.xml_assembled", length=len(result), cin=self.cin)
            return result

    def _build_xml(self) -> str:
        xml = []
        xml.append('<?xml version="1.0" encoding="UTF-8"?>')
        xml.append('<xbrli:xbrl')
        xml.append('  xmlns:in-ca="http://www.mca.gov.in/in-ca/2016-03-31"')
        xml.append('  xmlns:ind-as="http://www.mca.gov.in/ind-as/2016-03-31"')
        xml.append('  xmlns:xbrli="http://www.xbrl.org/2003/instance"')
        xml.append('  xmlns:xlink="http://www.w3.org/1999/xlink"')
        xml.append('  xmlns:link="http://www.xbrl.org/2003/linkbase"')
        xml.append('  xmlns:xbrldi="http://xbrl.org/2006/xbrldi"')
        xml.append('  xmlns:iso4217="http://www.xbrl.org/2003/iso4217">')
        xml.append('  <link:schemaRef xlink:href="http://www.mca.gov.in/ind-as/2016-03-31/ind-as-2016-03-31.xsd" xlink:type="simple"/>')
        xml.append('')

        # 1. Standard Contexts
        xml.append('  <!-- 1. STANDARD CONTEXTS -->')
        xml.append('  <xbrli:context id="CY_Instant">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:instant>{self.end_date}</xbrli:instant></xbrli:period>')
        xml.append('  </xbrli:context>')

        xml.append('  <xbrli:context id="PY_Instant">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:instant>{self.py_end_date}</xbrli:instant></xbrli:period>')
        xml.append('  </xbrli:context>')

        xml.append('  <xbrli:context id="CY_Duration">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:startDate>{self.start_date}</xbrli:startDate><xbrli:endDate>{self.end_date}</xbrli:endDate></xbrli:period>')
        xml.append('  </xbrli:context>')

        xml.append('  <xbrli:context id="PY_Duration">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:startDate>{self.py_start_date}</xbrli:startDate><xbrli:endDate>{self.py_end_date}</xbrli:endDate></xbrli:period>')
        xml.append('  </xbrli:context>')
        xml.append('')

        # 2. PPE Dimensional Contexts
        xml.append('  <!-- 2. PPE DIMENSIONAL CONTEXTS -->')
        for tbl in self.payload.get("tables", []):
            axis = tbl.get("axis", "ind-as:ClassesOfPropertyPlantAndEquipmentAxis")
            for row in tbl.get("rows", []):
                member = row.get("member")
                clean_m = member.split(":")[-1]
                # CY Duration Context
                xml.append(f'  <xbrli:context id="CY_Duration_{clean_m}">')
                xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier>')
                xml.append(f'      <xbrli:segment><xbrldi:explicitMember dimension="{axis}">{member}</xbrldi:explicitMember></xbrli:segment>')
                xml.append('    </xbrli:entity>')
                xml.append(f'    <xbrli:period><xbrli:startDate>{self.start_date}</xbrli:startDate><xbrli:endDate>{self.end_date}</xbrli:endDate></xbrli:period>')
                xml.append('  </xbrli:context>')
                # CY Instant Context
                xml.append(f'  <xbrli:context id="CY_Instant_{clean_m}">')
                xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier>')
                xml.append(f'      <xbrli:segment><xbrldi:explicitMember dimension="{axis}">{member}</xbrldi:explicitMember></xbrli:segment>')
                xml.append('    </xbrli:entity>')
                xml.append(f'    <xbrli:period><xbrli:instant>{self.end_date}</xbrli:instant></xbrli:period>')
                xml.append('  </xbrli:context>')
        xml.append('')

        # 3. Director Signatories Contexts
        xml.append('  <!-- 3. DIRECTOR SIGNATORIES CONTEXTS -->')
        for d in self.master.get("signatories", []):
            din = d.get("din")
            xml.append(f'  <xbrli:context id="Director_{din}">')
            xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier>')
            xml.append('      <xbrli:segment>')
            xml.append('        <xbrldi:typedMember dimension="in-ca:DirectorsSigningFinancialStatementsAxis">')
            xml.append(f'          <in-ca:DirectorIdentificationNumberOfDirector>{din}</in-ca:DirectorIdentificationNumberOfDirector>')
            xml.append('        </xbrldi:typedMember>')
            xml.append('      </xbrli:segment>')
            xml.append('    </xbrli:entity>')
            xml.append(f'    <xbrli:period><xbrli:startDate>{self.start_date}</xbrli:startDate><xbrli:endDate>{self.end_date}</xbrli:endDate></xbrli:period>')
            xml.append('  </xbrli:context>')
        xml.append('')

        # 4. Units
        xml.append('  <!-- 4. UNITS -->')
        xml.append('  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>')
        xml.append('  <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>')
        xml.append('  <xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>')
        xml.append('')

        # 5. Master Facts (Escaped)
        xml.append('  <!-- 5. MASTER FACTS -->')
        for k, v in self.master.get("company", {}).items():
            xml.append(f'  <{k} contextRef="CY_Duration">{html.escape(str(v))}</{k}>')
        for k, v in self.master.get("auditor", {}).items():
            xml.append(f'  <{k} contextRef="CY_Duration">{html.escape(str(v))}</{k}>')
        for d in self.master.get("signatories", []):
            din = str(d.get("din", "")).strip()
            ctx = f"Director_{din}"
            first_name = d.get("firstName")
            last_name = d.get("lastName")
            if not first_name and "name" in d:
                parts = str(d["name"]).strip().split()
                first_name = parts[0] if parts else "Director"
                last_name = " ".join(parts[1:]) if len(parts) > 1 else "."
            designation = d.get("designation", "Director")
            signing_date = d.get("signingDate") or self.master.get("company", {}).get("in-ca:DateOfBoardMeetingWhenFinalAccountsWereApproved", "2026-04-25")

            xml.append(f'  <in-ca:DirectorIdentificationNumberOfDirector contextRef="{ctx}">{din}</in-ca:DirectorIdentificationNumberOfDirector>')
            xml.append(f'  <in-ca:FirstNameOfDirector contextRef="{ctx}">{html.escape(str(first_name or ""))}</in-ca:FirstNameOfDirector>')
            xml.append(f'  <in-ca:LastNameOfDirector contextRef="{ctx}">{html.escape(str(last_name or ""))}</in-ca:LastNameOfDirector>')
            xml.append(f'  <in-ca:DesignationOfDirector contextRef="{ctx}">{html.escape(str(designation))}</in-ca:DesignationOfDirector>')
            xml.append(f'  <in-ca:DateOfSigningOfFinancialStatementsByDirector contextRef="{ctx}">{signing_date}</in-ca:DateOfSigningOfFinancialStatementsByDirector>')
        xml.append('')

        # 6. Balance Sheet Facts (CY Instant & PY Instant)
        xml.append('  <!-- 6. BALANCE SHEET FACTS -->')
        bs_items = self.statements.get("balanceSheet", []) or self.statements.get("balance_sheet", [])
        for r in bs_items:
            c = r["concept"]
            if "cy" in r and r["cy"] is not None:
                xml.append(f'  <{c} contextRef="CY_Instant" unitRef="INR" decimals="0">{int(r["cy"])}</{c}>')
            if "py" in r and r["py"] is not None:
                xml.append(f'  <{c} contextRef="PY_Instant" unitRef="INR" decimals="0">{int(r["py"])}</{c}>')
        xml.append('')

        # 7. Profit & Loss Facts (CY Duration & PY Duration)
        xml.append('  <!-- 7. PROFIT & LOSS FACTS -->')
        pnl_items = self.statements.get("profitLoss", []) or self.statements.get("profit_and_loss", []) or self.statements.get("pnl", [])
        for r in pnl_items:
            c = r["concept"]
            if "cy" in r and r["cy"] is not None:
                xml.append(f'  <{c} contextRef="CY_Duration" unitRef="INR" decimals="0">{int(r["cy"])}</{c}>')
            if "py" in r and r["py"] is not None:
                xml.append(f'  <{c} contextRef="PY_Duration" unitRef="INR" decimals="0">{int(r["py"])}</{c}>')
        xml.append('')

        # 8. PPE Schedule Facts
        xml.append('  <!-- 8. PPE SCHEDULE FACTS -->')
        for tbl in self.payload.get("tables", []):
            for row in tbl.get("rows", []):
                clean_m = row["member"].split(":")[-1]
                c_dur = f"CY_Duration_{clean_m}"
                c_inst = f"CY_Instant_{clean_m}"
                xml.append(f'  <ind-as:PropertyPlantAndEquipment contextRef="{c_inst}" unitRef="INR" decimals="0">{int(row["grossClosing"])}</ind-as:PropertyPlantAndEquipment>')
                xml.append(f'  <ind-as:AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment contextRef="{c_dur}" unitRef="INR" decimals="0">{int(row["grossAdditions"])}</ind-as:AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment>')
                xml.append(f'  <ind-as:DisposalsPropertyPlantAndEquipment contextRef="{c_dur}" unitRef="INR" decimals="0">{int(row["grossDisposals"])}</ind-as:DisposalsPropertyPlantAndEquipment>')
                xml.append(f'  <ind-as:DepreciationPropertyPlantAndEquipment contextRef="{c_dur}" unitRef="INR" decimals="0">{int(row["depForYear"])}</ind-as:DepreciationPropertyPlantAndEquipment>')
        xml.append('')

        # 9. Notes TextBlock Facts (CDATA XHTML)
        xml.append('  <!-- 9. NARRATIVE NOTES EXPLANATORY FACTS -->')
        for note in self.notes:
            concept = note["concept"]
            text = note["content"]
            xml.append(f'  <{concept} contextRef="CY_Duration"><![CDATA[<p style="text-align:justify; font-family:Arial,sans-serif; font-size:10pt;">{text}</p>]]></{concept}>')
        xml.append('')

        xml.append('</xbrli:xbrl>')
        return chr(10).join(xml)


class XMLGenerationPipeline(Pipeline):
    def __init__(self, payload: dict[str, Any]):
        self.payload = payload
        self.validator = IndASValidator(kb_path=INDAS_OUTPUT_JSON_PATH)
        self.generator = XbrlXmlGenerator(payload=payload)

    async def initiate(self, unique_id: str) -> dict[str, Any]:
        with logger.span("pipeline.xml_generation", unique_id=unique_id):
            is_valid, errors = self.validator.validate(payload=self.payload)
            if not is_valid:
                logger.warning("pipeline.xml_generation.rejected", unique_id=unique_id, error_count=len(errors))
                return {"success": False, "errors": errors}

            xml_content = self.generator.build()
            output_base = BASE_DIR / OUTPUT_DIR
            file_name = "MCA_AOC4_XML.xml"
            file_path = output_base / unique_id / file_name
            file_path.parent.mkdir(parents=True, exist_ok=True)
            await save_xml(file_path=file_path, content=xml_content)

            file_size_kb = round(os.path.getsize(file_path) / 1024, 2)
            logger.info("pipeline.xml_generation.saved", file_path=str(file_path), file_size_kb=file_size_kb)
            return {
                "success": True,
                "unique_id": unique_id,
                "file_name": file_name,
                "file_path": str(file_path),
                "file_size_kb": file_size_kb,
                "xml_content": xml_content,
            }

