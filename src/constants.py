import os
from pathlib import Path
# ===================== EXTRACTORS =======================
_env_res = os.environ.get("XAP_RESOURCES")
if _env_res and Path(_env_res).exists():
    BASE_DIR = Path(_env_res)
else:
    BASE_DIR = Path(__file__).resolve().parent.parent

# Ind_as
INDAS_ROOT_PATH = BASE_DIR / "data" / "IND-AS taxonomy"
INDAS_TAXONOMY_DIR_PATH = INDAS_ROOT_PATH / "Taxonomy for IND-AS V1.2@31-03-2017" / "Ind AS taxonomy" / "Ind AS taxonomy"
INDAS_RULES_EXCEL_PATH = INDAS_ROOT_PATH / "buisness_rules" / "BusinessRulesforIndASTaxonomyV1.2@-" / "Business Rules for IndAS Taxonomy V1.2.xlsx"
INDAS_OUTPUT_JSON_PATH = BASE_DIR / "knowledge_base" / "ind_as_knowledge_base.json"

# Engine authorities (DTS-resolved concepts, networks and dimensional model), served by /{id}/authority
CI_ENGINE_AUTHORITY_JSON = BASE_DIR / "knowledge_base" / "ci_engine_authority.json"
INDAS_ENGINE_AUTHORITY_JSON = BASE_DIR / "knowledge_base" / "ind_as_engine_authority.json"


# ===================== TAXONOMIES_NAME ============
IND_AS_TAXONOMY_VDB: str = "ind_as_taxonomy"
AGENT_COLLECTION_NAME: str = "xbrl_agent"
ALL_QDRANT_COLLECTIONS: list[str] = [
    IND_AS_TAXONOMY_VDB,
    AGENT_COLLECTION_NAME,
]

# ============ VectorDb Config ========================
VECTOR_DB_PATH = BASE_DIR / "chroma_langchain_db"
BATCH_SIZE = 500
BM25_DIR_PATH:str = BASE_DIR / "db"

# ============ Retriever Config =======================
HYBRID_SEARCH_K:int =10
BM25_WEIGHT:float = 0.5
VECTOR_DB_WEIGHT:float = 1-BM25_WEIGHT

# knowledge base for agent
AGENT_KNOWLEDGE_DATA_DIR = BASE_DIR / "data" / "agent"



# ================== XML Generation =================
OUTPUT_DIR:str = "output"