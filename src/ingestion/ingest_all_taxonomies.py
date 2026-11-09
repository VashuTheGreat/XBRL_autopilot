from src.constants import CI_OUTPUT_JSON, COST_OUTPUT_JSON, INDAS_OUTPUT_JSON
from src.utils.main_utils import load_json, to_chroma_metadata
from langchain_core.documents import Document
from src.constants import (
    BATCH_SIZE,
    IND_AS_TAXONOMY_VDB,
    CI_TAXONOMY_VDB,
    COSTING_TAXONOMY_VDB,
)
from src.ingestion.operations.store_taxonomies import StoreTaxonomies
from src.core.logger import logger


async def load_taxonomies(path: str) -> list[Document]:
    data = await load_json(path=path)

    taxonomies = []
    concepts = data.get("concepts", {})
    for qname, c in concepts.items():
        label = c.get("labels", {}).get("label", "") or ""
        name = c.get("name") or ""
        doc_entry = f"{label} | {qname} | {name}"
        meta = to_chroma_metadata(c)
        taxonomies.append(Document(page_content=doc_entry, metadata=meta))

    logger.info("ingestion.load_taxonomies", count=len(taxonomies))
    return taxonomies


async def ingest_collection(name: str, collection_key: str, items: list[Document]):
    logger.info("ingestion.starting", taxonomy=name, total_items=len(items))
    for i in range(0, len(items), BATCH_SIZE):
        batch = items[i : i + BATCH_SIZE]
        await StoreTaxonomies(taxonomies=batch, collection=collection_key)
        logger.info(
            "ingestion.batch_completed",
            taxonomy=name,
            progress=f"{min(i + BATCH_SIZE, len(items))}/{len(items)}",
        )
    logger.info("ingestion.completed", taxonomy=name, total=len(items))


async def ingest_all():
    ci_items = await load_taxonomies(CI_OUTPUT_JSON)
    await ingest_collection("C&I Taxonomy 2016", CI_TAXONOMY_VDB, ci_items)

    ind_as_items = await load_taxonomies(INDAS_OUTPUT_JSON)
    await ingest_collection("IND-AS Taxonomy", IND_AS_TAXONOMY_VDB, ind_as_items)

    costing_items = await load_taxonomies(COST_OUTPUT_JSON)
    await ingest_collection("Costing Taxonomy", COSTING_TAXONOMY_VDB, costing_items)
