"""What the rule builder needs to know about each taxonomy's MCA business-rule workbook."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from src.constants import BASE_DIR, CI_RULES_EXCEL, CI_TAXONOMY_VDB, IND_AS_TAXONOMY_VDB, INDAS_RULES_EXCEL
from src.services.engine_authority.specs import SPECS as AUTHORITY_SPECS
from src.services.engine_rules.generic import CI_GENERIC, Handler
from src.services.engine_rules.generic_ind_as import IND_AS_GENERIC
from src.services.engine_rules.workbook import SpecificRules, Workbook, specific_rules, specific_rules_ind_as

KB_DIR = BASE_DIR / "knowledge_base"
CURATION_DIR = Path(__file__).parent / "curation"
REPORT_DIR = BASE_DIR / "docs" / "generated"


@dataclass(frozen=True)
class RuleSpec:
    id: str  # knowledge-base id (ci_taxonomy | ind_as_taxonomy)
    kb: str  # file stem: ci | ind_as
    dts: str  # how reasons name the taxonomy: "C&I 2016"
    title: str  # report title
    workbook: Path
    specific_rules: Callable[[Workbook], SpecificRules]  # the workbook's layout of "Specific rules for elements"
    generic: dict[int, Handler]  # workbook generic-rule number → engine handler
    # further clause boundaries this workbook uses (Ind AS: "This is a mandatory field, Should be …")
    extra_split: str | None = None
    # Yes/No answers also restrict availability (C&I: MCA-validated C&I filings). Ind AS: no — the MCA-accepted Dixon
    # instance answers No and still files the major-customer, share-based payment and lease tables and nil OCI / CSR
    # amounts, so those values stay filing data (the rules still require them under Yes).
    yes_no_restricts: bool = True

    @property
    def authority_file(self) -> Path:
        return AUTHORITY_SPECS[self.id].output

    @property
    def rules_file(self) -> Path:
        return KB_DIR / f"{self.kb}_engine_rules.json"

    @property
    def coverage_file(self) -> Path:
        return KB_DIR / f"{self.kb}_rule_coverage.json"

    @property
    def report_file(self) -> Path:
        return REPORT_DIR / f"rule-coverage-{self.kb}.md"

    @property
    def curation_dir(self) -> Path:
        return CURATION_DIR / self.kb


CI_2016 = RuleSpec(
    id=CI_TAXONOMY_VDB, kb="ci", dts="C&I 2016", title="C&I 2016 (Business Rules V1.3)",
    workbook=CI_RULES_EXCEL, specific_rules=specific_rules, generic=CI_GENERIC,
)

IND_AS_2017 = RuleSpec(
    id=IND_AS_TAXONOMY_VDB, kb="ind_as", dts="Ind AS 2017", title="Ind AS 2017 (Business Rules V1.2)",
    workbook=INDAS_RULES_EXCEL, specific_rules=specific_rules_ind_as, generic=IND_AS_GENERIC, extra_split=r",\s+(?=Should\b)",
    yes_no_restricts=False,
)

RULE_SPECS: dict[str, RuleSpec] = {s.id: s for s in (CI_2016, IND_AS_2017)}
