"""Automated taxonomy ingestion pipeline.

Extracts concepts, labels, and documentation from C&I, IND-AS, and Costing taxonomies
and ingests them into the Chroma vector database using the protected StoreTaxonomies interface.
"""

from __future__ import annotations
import asyncio
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile
import openpyxl

from src.constants import CI_TAXONOMY, COSTING_TAXONOMY, IND_AS_TAXONOMY
from src.core.logger import logger
from src.ingestion.store_taxonomies import StoreTaxonomies

ROOT_DIR = Path(__file__).resolve().parents[2]
BATCH_SIZE = 250


def load_ci_taxonomy() -> list[str]:
    """Extract C&I concepts and labels from standardized knowledge base."""
    candidates = [
        ROOT_DIR / "Knowlege_base" / "ci_knowledge_base.json",
        ROOT_DIR / "Knowlege_base" / "MCA_AUTHORITY.json",
        ROOT_DIR / "Knowledge_base" / "MCA_AUTHORITY.json",
    ]
    path = next((c for c in candidates if c.exists()), None)
    if not path:
        from src.ingestion.compile_taxonomies import TaxonomyCompiler
        TaxonomyCompiler().compile_ci()
        path = ROOT_DIR / "Knowlege_base" / "ci_knowledge_base.json"

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    concepts = data.get("concepts", {})
    entries: list[str] = []
    seen: set[str] = set()

    for qname, c in concepts.items():
        if not isinstance(c, dict):
            continue
        labels = c.get("labels", {})
        label = labels.get("label") or labels.get("terseLabel") or c.get("name") or qname
        name = c.get("name") or qname.split(":")[-1]
        
        doc_entry = f"{label} | {qname} | {name}"
        if doc_entry not in seen:
            seen.add(doc_entry)
            entries.append(doc_entry)

    logger.info("ingestion.ci.loaded", count=len(entries))
    return entries


def load_ind_as_taxonomy() -> list[str]:
    """Extract IND-AS concepts and labels from standardized knowledge base."""
    kb_path = ROOT_DIR / "Knowlege_base" / "ind_as_knowledge_base.json"
    if not kb_path.exists():
        from src.ingestion.compile_taxonomies import TaxonomyCompiler
        TaxonomyCompiler().compile_ind_as()

    with open(kb_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    concepts = data.get("concepts", {})
    entries: list[str] = []
    seen: set[str] = set()

    for qname, c in concepts.items():
        if not isinstance(c, dict):
            continue
        labels = c.get("labels", {})
        label = labels.get("label") or labels.get("terseLabel") or c.get("name") or qname
        name = c.get("name") or qname.split(":")[-1]

        doc_entry = f"{label} | {qname} | {name}"
        if doc_entry not in seen:
            seen.add(doc_entry)
            entries.append(doc_entry)

    logger.info("ingestion.ind_as.loaded", count=len(entries))
    return entries


def load_costing_taxonomy() -> list[str]:
    """Extract Costing taxonomy concepts and labels from standardized knowledge base."""
    kb_path = ROOT_DIR / "Knowlege_base" / "costing_knowledge_base.json"
    if not kb_path.exists():
        from src.ingestion.compile_taxonomies import TaxonomyCompiler
        TaxonomyCompiler().compile_costing()

    with open(kb_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    concepts = data.get("concepts", {})
    entries: list[str] = []
    seen: set[str] = set()

    for qname, c in concepts.items():
        if not isinstance(c, dict):
            continue
        labels = c.get("labels", {})
        label = labels.get("label") or labels.get("terseLabel") or c.get("name") or qname
        name = c.get("name") or qname.split(":")[-1]

        doc_entry = f"{label} | {qname} | {name}"
        if doc_entry not in seen:
            seen.add(doc_entry)
            entries.append(doc_entry)

    logger.info("ingestion.costing.loaded", count=len(entries))
    return entries


async def ingest_collection(name: str, collection_key: str, items: list[str]):
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


async def ingest_all(taxonomies: list[str] | None = None):
    targets = taxonomies or ["ci", "ind_as", "costing"]
    
    if "ci" in targets:
        ci_items = load_ci_taxonomy()
        if ci_items:
            await ingest_collection("C&I Taxonomy 2016", CI_TAXONOMY, ci_items)

    if "ind_as" in targets:
        ind_as_items = load_ind_as_taxonomy()
        if ind_as_items:
            await ingest_collection("IND-AS Taxonomy", IND_AS_TAXONOMY, ind_as_items)

    if "costing" in targets:
        costing_items = load_costing_taxonomy()
        if costing_items:
            await ingest_collection("Costing Taxonomy", COSTING_TAXONOMY, costing_items)


def main():
    import sys
    targets = sys.argv[1:] if len(sys.argv) > 1 else None
    asyncio.run(ingest_all(targets))


if __name__ == "__main__":
    main()
