from src.constants import VECTOR_DB_PATH
import asyncio
import argparse
from src.services.extractors import (
    ci,
    cost,
    ind_as
)
import shutil
from .ingest_all_taxonomies import ingest_all
from . import build_engine_authorities


async def create_json_files():
    await asyncio.gather(
        ci.main(),
        cost.main(),
        ind_as.main()
    )




def wipe_chroma_vector_db():
    """Wipes the chroma_langchain_db directory to ensure clean vector state."""
    print("\n" + "=" * 70)
    print("STEP 3: WIPING chroma_langchain_db/ FOR FRESH RE-INDEXING")
    print("=" * 70)

    if VECTOR_DB_PATH.exists():
        print(f"  🗑️  Deleting existing Chroma DB directory: {VECTOR_DB_PATH}")
        shutil.rmtree(VECTOR_DB_PATH, ignore_errors=True)
        print("  ✅ Chroma DB directory wiped.")
    else:
        print("  ℹ️  chroma_langchain_db directory does not exist, proceeding.")


async def run_taxonomy_ingestion():
    """Executes ingest_all_taxonomies.py pipeline across C&I, IND-AS, and Costing."""
    print("\n" + "=" * 70)
    print("STEP 4: RUNNING ingest_all_taxonomies.py TO POPULATE CHROMADB")
    print("=" * 70)


    print("  🚀 Re-indexing C&I, IND-AS, and Costing taxonomies into ChromaDB...")
    await ingest_all()
    print("  ✅ ChromaDB taxonomy collections successfully built and stored!")



async def main():
    parser = argparse.ArgumentParser(description="Rebuild XBRL Knowledge Base and Vector Database from data/")
    parser.add_argument("--skip-chroma", action="store_true", help="Skip wiping and rebuilding Chroma vector database")
    args = parser.parse_args()

    await create_json_files()
    # engine authorities (DTS, networks, dimensional model) served by /{id}/authority (ADR-0010)
    build_engine_authorities.main()

    if not args.skip_chroma:
        wipe_chroma_vector_db()
        await run_taxonomy_ingestion()

    print("\n" + "=" * 70)
    print("✨ MCA XBRL TAXONOMY & KNOWLEDGE BASE REBUILD COMPLETED SUCCESSFULLY!")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
