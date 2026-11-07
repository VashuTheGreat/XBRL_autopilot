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
    """Extract C&I concepts and labels from compiled MCA_AUTHORITY.json."""
    candidates = [
        ROOT_DIR / "Knowlege_base" / "MCA_AUTHORITY.json",
        ROOT_DIR / "Knowledge_base" / "MCA_AUTHORITY.json",
    ]
    path = next((c for c in candidates if c.exists()), None)
    if not path:
        logger.error("ingestion.ci.missing_authority_file")
        return []

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
    """Extract IND-AS concepts and labels from unzipped directory or zip package."""
    unzipped_dir = ROOT_DIR / "data" / "IND-AS taxonomy" / "Taxonomy for IND-AS V1.2@31-03-2017" / "Ind AS taxonomy"
    zip_path = ROOT_DIR / "data" / "IND-AS taxonomy" / "Taxonomy for IND-AS V1.2@31-03-2017.zip"

    entries: list[str] = []
    seen: set[str] = set()

    def parse_label_file(file_obj, filename: str):
        try:
            tree = ET.parse(file_obj)
            root = tree.getroot()
            prefix = "in-ca" if "in-ca" in filename else "ind-as"
            for elem in root.findall(".//{http://www.xbrl.org/2003/linkbase}label"):
                lbl_id = elem.attrib.get("id", "")
                text = (elem.text or "").strip()
                if lbl_id.startswith("label_") and text:
                    concept_name = lbl_id[6:]
                    qname = f"{prefix}:{concept_name}"
                    doc_entry = f"{text} | {qname} | {concept_name}"
                    if doc_entry not in seen:
                        seen.add(doc_entry)
                        entries.append(doc_entry)
        except Exception as e:
            logger.warning("ingestion.ind_as.parse_error", file=filename, error=str(e))

    if unzipped_dir.exists():
        for xml_file in unzipped_dir.rglob("*label*.xml"):
            with open(xml_file, "rb") as f:
                parse_label_file(f, xml_file.name)
        for xml_file in unzipped_dir.rglob("*-lab-*.xml"):
            with open(xml_file, "rb") as f:
                parse_label_file(f, xml_file.name)
    elif zip_path.exists():
        with zipfile.ZipFile(zip_path) as z:
            for name in z.namelist():
                if ("label" in name or "-lab-" in name) and name.endswith(".xml"):
                    with z.open(name) as f:
                        parse_label_file(f, name)
    else:
        logger.error("ingestion.ind_as.missing_resources", path=str(zip_path))
        return []

    logger.info("ingestion.ind_as.loaded", count=len(entries))
    return entries


def load_costing_taxonomy() -> list[str]:
    """Extract Costing taxonomy concepts and labels from unzipped Excel or zip archive."""
    unzipped_xlsx = (
        ROOT_DIR
        / "data"
        / "Costing Taxonomy"
        / "Costing Taxonomy 2019 Version 1.1@31-03-2019"
        / "FinalCostingTaxonomy2019_V1.1"
        / "CostingTaxonomy2019_Cost Audit.xlsx"
    )
    zip_path = ROOT_DIR / "data" / "Costing Taxonomy" / "Costing Taxonomy 2019 Version 1.1@31-03-2019.zip"

    entries: list[str] = []
    seen: set[str] = set()

    wb = None
    if unzipped_xlsx.exists():
        wb = openpyxl.load_workbook(unzipped_xlsx, read_only=True)
    elif zip_path.exists():
        with zipfile.ZipFile(zip_path) as z:
            excel_name = "FinalCostingTaxonomy2019_V1.1/CostingTaxonomy2019_Cost Audit.xlsx"
            if excel_name in z.namelist():
                with z.open(excel_name) as f:
                    wb = openpyxl.load_workbook(io.BytesIO(f.read()), read_only=True)

    if wb and "Labels" in wb.sheetnames:
        ws = wb["Labels"]
        for row in ws.iter_rows(values_only=True):
            if len(row) >= 4 and row[2] and row[2] != "Element Name":
                prefix = str(row[1] or "in-cost").strip()
                concept_name = str(row[2]).strip()
                label = str(row[3] or concept_name).strip()
                qname = f"{prefix}:{concept_name}"
                doc_entry = f"{label} | {qname} | {concept_name}"
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
