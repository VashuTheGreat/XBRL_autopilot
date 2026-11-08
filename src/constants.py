VECTOR_DB_PATH = "chroma_langchain_db"

IND_AS_TAXONOMY: str = "ind_as_taxonomy"
CI_TAXONOMY: str = "ci_taxonomy"
COSTING_TAXONOMY: str = "costing_taxonomy"

# Standard Taxonomy Codes
TAXONOMY_CI: str = "ci"
TAXONOMY_IND_AS: str = "ind_as"
TAXONOMY_COSTING: str = "costing"

SCHEMA_REFS: dict[str, str] = {
    "ci": "https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd",
    "ind_as": "https://www.mca.gov.in/V3XBRL/2017/03/31/Taxonomy/IndAS/in-ci-ent-2017-03-31.xsd",
    "costing": "https://www.mca.gov.in/V3XBRL/2018/04/01/Taxonomy/Costing/in-cost-aud-2018-04-01.xsd",
}

ENTRY_POINTS: dict[str, str] = {
    "ci": "in-ci-ent-2016-03-31.xsd",
    "ind_as": "in-ca-ent-2017-03-31.xsd",
    "costing": "in-cost-aud-2018-04-01.xsd",
}

COLLECTION_MAP: dict[str, str] = {
    "ci": CI_TAXONOMY,
    "ind_as": IND_AS_TAXONOMY,
    "costing": COSTING_TAXONOMY,
}
