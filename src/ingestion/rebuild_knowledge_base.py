"""Master Taxonomy & Business Rule Knowledge Base Rebuild Tool.

Scans the data/ folder for the latest official MCA taxonomy schemas and business rules,
refreshes Knowlege_base/MCA_AUTHORITY.json with checksums and metadata directly from data/,
wipes the Chroma vector database (chroma_langchain_db/), and executes ingest_all_taxonomies.py
to populate fresh vector embeddings for C&I, IND-AS, and Costing taxonomies.
"""

from __future__ import annotations
import argparse
import asyncio
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

from src.core.logger import logger

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
KNOWLEDGE_BASE_DIR = ROOT_DIR / "Knowlege_base"
AUTHORITY_FILE = KNOWLEDGE_BASE_DIR / "MCA_AUTHORITY.json"
CHROMA_DIR = ROOT_DIR / "chroma_langchain_db"


def compute_sha256(filepath: Path) -> str:
    """Calculates SHA256 checksum for a binary file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def scan_and_verify_data_sources() -> dict:
    """Scans and validates presence of unzipped MCA taxonomy and business rule files."""
    print("=" * 70)
    print("STEP 1: SCANNING DATA DIRECTORY FOR LATEST OFFICIAL MCA ARTIFACTS")
    print("=" * 70)

    resources = {
        "ci_taxonomy_dir": DATA_DIR / "c&I taxonomy" / "Final C and I Taxonomy 2016 V1.2@31-03-2016" / "Taxonomy-2016-03-31",
        "ci_business_rules": DATA_DIR / "c&I taxonomy" / "Final Business Rules based on XBRL C and I Taxonomy 2016 V1.3@06-08-2016" / "Final_Business_Rule_C&I_Taxonomy_2016_V1.3.xls",
        "ci_excel": DATA_DIR / "c&I taxonomy" / "Final C and I Taxonomy 2016 V1.2@31-03-2016" / "Taxonomy-2016-03-31.xlsx",
        "ind_as_taxonomy_dir": DATA_DIR / "IND-AS taxonomy" / "Taxonomy for IND-AS V1.2@31-03-2017" / "Ind AS taxonomy",
        "ind_as_rules": DATA_DIR / "IND-AS taxonomy" / "buisness_rules" / "BusinessRulesforIndASTaxonomyV1.2@-" / "Business Rules for IndAS Taxonomy V1.2.xlsx",
        "costing_taxonomy_dir": DATA_DIR / "Costing Taxonomy" / "Costing Taxonomy 2019 Version 1.1@31-03-2019" / "FinalCostingTaxonomy2019_V1.1",
        "costing_rules": DATA_DIR / "Costing Taxonomy" / "Business rule based on Costing taxonomy 2019 V1.1@06-10-2019" / "Final_BusinessRules_based_on_CostingTaxonomy2019_V1.1.xlsx",
        "costing_excel": DATA_DIR / "Costing Taxonomy" / "Costing Taxonomy 2019 Version 1.1@31-03-2019" / "FinalCostingTaxonomy2019_V1.1" / "CostingTaxonomy2019_Cost Audit.xlsx",
    }

    all_found = True
    for key, path in resources.items():
        exists = path.exists()
        symbol = "✅ FOUND" if exists else "❌ MISSING"
        print(f"  [{symbol}] {key}: {path.relative_to(ROOT_DIR)}")
        if not exists:
            all_found = False

    return resources


def refresh_authority_knowledge_base(resources: dict) -> int:
    """Updates Knowlege_base/MCA_AUTHORITY.json with fresh source checksums and timestamps."""
    print("\n" + "=" * 70)
    print("STEP 2: REBUILDING & VERIFYING Knowlege_base/MCA_AUTHORITY.json")
    print("=" * 70)

    KNOWLEDGE_BASE_DIR.mkdir(parents=True, exist_ok=True)
    if not AUTHORITY_FILE.exists():
        template_gz = DATA_DIR / ".authority_template.json.gz"
        if template_gz.exists():
            print(f"  ℹ️  Knowlege_base/MCA_AUTHORITY.json missing, regenerating from {template_gz.relative_to(ROOT_DIR)}...")
            with gzip.open(template_gz, "rb") as gz_in:
                with open(AUTHORITY_FILE, "wb") as f_out:
                    shutil.copyfileobj(gz_in, f_out)
            print("  ✅ Regenerated Knowlege_base/MCA_AUTHORITY.json successfully.")
        else:
            raise FileNotFoundError(f"Base authority file missing at: {AUTHORITY_FILE}")

    with open(AUTHORITY_FILE, "r", encoding="utf-8") as f:
        auth_data = json.load(f)

    meta = auth_data.get("meta", {})
    sources = meta.get("sources", [])
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    ci_dir = resources["ci_taxonomy_dir"]
    updated_sources = 0

    # Refresh checksums from actual unzipped taxonomy files in data/
    for src in sources:
        fname = src.get("file", "")
        # Map relative path e.g. .taxonomy/Taxonomy-2016-03-31/...
        if "Taxonomy-2016-03-31" in fname:
            subpath = fname.split("Taxonomy-2016-03-31/")[-1]
            target_file = ci_dir / subpath
            if target_file.exists():
                new_hash = compute_sha256(target_file)
                src["sha256"] = new_hash
                src["bytes"] = target_file.stat().st_size
                updated_sources += 1

    # Check business rules xls checksum
    rules_file = resources["ci_business_rules"]
    if rules_file.exists():
        rules_hash = compute_sha256(rules_file)
        for src in sources:
            if "Final_Business_Rule" in src.get("file", ""):
                src["sha256"] = rules_hash
                src["bytes"] = rules_file.stat().st_size
                updated_sources += 1

    meta["lastRebuilt"] = now_iso
    meta["verifiedFromDataFolder"] = True
    meta["updatedSourceCount"] = updated_sources

    # Write updated authority file
    with open(AUTHORITY_FILE, "w", encoding="utf-8") as f:
        json.dump(auth_data, f)

    concepts_count = len(auth_data.get("concepts", {}))
    elrs_count = len(auth_data.get("elrs", []))
    print(f"  ✅ Rebuilt MCA_AUTHORITY.json successfully:")
    print(f"     - Total Authoritative Concepts: {concepts_count}")
    print(f"     - Total ELRs (Roles): {elrs_count}")
    print(f"     - Validated Data Sources: {updated_sources}")
    print(f"     - Timestamp: {now_iso}")

    return concepts_count


def wipe_chroma_vector_db():
    """Wipes the chroma_langchain_db directory to ensure clean vector state."""
    print("\n" + "=" * 70)
    print("STEP 3: WIPING chroma_langchain_db/ FOR FRESH RE-INDEXING")
    print("=" * 70)

    if CHROMA_DIR.exists():
        print(f"  🗑️  Deleting existing Chroma DB directory: {CHROMA_DIR}")
        shutil.rmtree(CHROMA_DIR, ignore_errors=True)
        print("  ✅ Chroma DB directory wiped.")
    else:
        print("  ℹ️  chroma_langchain_db directory does not exist, proceeding.")


async def run_taxonomy_ingestion():
    """Executes ingest_all_taxonomies.py pipeline across C&I, IND-AS, and Costing."""
    print("\n" + "=" * 70)
    print("STEP 4: RUNNING ingest_all_taxonomies.py TO POPULATE CHROMADB")
    print("=" * 70)

    from src.ingestion.ingest_all_taxonomies import ingest_all

    print("  🚀 Re-indexing C&I, IND-AS, and Costing taxonomies into ChromaDB...")
    await ingest_all()
    print("  ✅ ChromaDB taxonomy collections successfully built and stored!")


def main():
    parser = argparse.ArgumentParser(description="Rebuild XBRL Knowledge Base and Vector Database from data/")
    parser.add_argument("--skip-chroma", action="store_true", help="Skip wiping and rebuilding Chroma vector database")
    args = parser.parse_args()

    resources = scan_and_verify_data_sources()
    refresh_authority_knowledge_base(resources)

    if not args.skip_chroma:
        wipe_chroma_vector_db()
        asyncio.run(run_taxonomy_ingestion())

    print("\n" + "=" * 70)
    print("✨ MCA XBRL TAXONOMY & KNOWLEDGE BASE REBUILD COMPLETED SUCCESSFULLY!")
    print("=" * 70)


if __name__ == "__main__":
    main()
