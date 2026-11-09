from pathlib import Path
# ===================== EXTRACTORS =======================
BASE_DIR = Path(__file__).parent.parent

# Ind_as
INDAS_ROOT = BASE_DIR / "data" / "IND-AS taxonomy"
INDAS_TAXONOMY_DIR = INDAS_ROOT / "Taxonomy for IND-AS V1.2@31-03-2017" / "Ind AS taxonomy" / "Ind AS taxonomy"
INDAS_RULES_EXCEL = INDAS_ROOT / "buisness_rules" / "BusinessRulesforIndASTaxonomyV1.2@-" / "Business Rules for IndAS Taxonomy V1.2.xlsx"
INDAS_OUTPUT_JSON = BASE_DIR / "knowledge_base" / "ind_as_knowledge_base.json"

# CI
CI_TAXONOMY_DIR = BASE_DIR / 'data' / 'c&I taxonomy' / 'Final C and I Taxonomy 2016 V1.2@31-03-2016' / 'Taxonomy-2016-03-31'
CI_RULES_EXCEL = BASE_DIR / 'data' / 'c&I taxonomy' / 'Final Business Rules based on XBRL C and I Taxonomy 2016 V1.3@06-08-2016' / 'Final_Business_Rule_C&I_Taxonomy_2016_V1.3.xls'
CI_OUTPUT_JSON = BASE_DIR / "knowledge_base" / 'ci_knowledge_base.json'

# cost
COST_ROOT = BASE_DIR / "data" / "Costing Taxonomy"
COST_TAXONOMY_DIR = COST_ROOT / "Costing Taxonomy 2019 Version 1.1@31-03-2019" / "FinalCostingTaxonomy2019_V1.1" / "Taxonomy"
COST_RULES_EXCEL = COST_ROOT / "Business rule based on Costing taxonomy 2019 V1.1@06-10-2019" / "Final_BusinessRules_based_on_CostingTaxonomy2019_V1.1.xlsx"
COST_OUTPUT_JSON = BASE_DIR / "knowledge_base" / "cost_knowledge_base.json"


# ===================== TAXONOMIES_NAME ============
IND_AS_TAXONOMY_VDB: str = "ind_as_taxonomy"
CI_TAXONOMY_VDB: str = "ci_taxonomy"
COSTING_TAXONOMY_VDB: str = "costing_taxonomy"
# ============ VectorDb Config ========================
VECTOR_DB_PATH = BASE_DIR / "chroma_langchain_db"
BATCH_SIZE = 500




