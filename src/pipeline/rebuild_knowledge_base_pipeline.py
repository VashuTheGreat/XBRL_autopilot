import argparse
import asyncio
import sys

from src.constants import (
    ALL_QDRANT_COLLECTIONS,
    CI_TAXONOMY_VDB,
    COST_TAXONOMY_VDB,
    IND_AS_TAXONOMY_VDB,
    XBRL_AGENT_VDB,
)
from src.core.logger import logger
from src.ingestion import build_engine_authorities, build_engine_rules
from src.pipeline.base import Pipeline
from src.pipeline.ingestion_pipeline import IngestionPipeline
from src.services.extractors import ci, cost, ind_as
from src.services.vectordb.qdrant import get_qdrant_service


class RebuildKnowledgeBasePipeline(Pipeline):
    def __init__(self):
        pass

    async def _create_json_files(self) -> None:
        """Run taxonomy extractors to build knowledge_base/*.json source files."""
        with logger.span("rebuild.create_json_files"):
            logger.info("rebuild.extractors_starting")
            await asyncio.gather(
                ci.main(),
                cost.main(),
                ind_as.main(),
            )
            logger.info("rebuild.extractors_completed")

    async def _reset_qdrant_collections(self) -> None:
        """Initialize Qdrant connection, delete existing 4 target collections, and recreate them fresh."""
        with logger.span("rebuild.reset_qdrant_collections"):
            logger.info("rebuild.resetting_collections", collections=ALL_QDRANT_COLLECTIONS)
            for collection_name in ALL_QDRANT_COLLECTIONS:
                store = get_qdrant_service(collection_name=collection_name)
                logger.info("rebuild.recreating_collection", collection=collection_name)
                await store.recreate_collection()
            logger.info("rebuild.all_collections_recreated")

    async def initiate(self) -> None:
        """Execute complete rebuild workflow: extractors -> authorities -> rules -> vector DB."""
        parser = argparse.ArgumentParser(
            description="Rebuild XBRL Knowledge Base and Qdrant Vector Database from data/"
        )
        parser.add_argument(
            "--skip-chroma",
            "--skip-qdrant",
            "--skip-vector-db",
            action="store_true",
            dest="skip_vector_db",
            help="Skip wiping and rebuilding Qdrant vector collections",
        )
        args, _ = parser.parse_known_args()

        with logger.span("rebuild_pipeline.execution", skip_vector_db=args.skip_vector_db):
            try:
                logger.info("rebuild.started")

                # Step 1: Extract taxonomy JSON files
                await self._create_json_files()

                # Step 2: Build engine authorities (ADR-0010)
                with logger.span("rebuild.build_engine_authorities"):
                    logger.info("rebuild.building_authorities")
                    build_engine_authorities.main()
                    logger.info("rebuild.authorities_complete")

                # Step 3: Build engine rules (ADR-0011)
                with logger.span("rebuild.build_engine_rules"):
                    logger.info("rebuild.building_rules")
                    build_engine_rules.main()
                    logger.info("rebuild.rules_complete")

                # Step 4 & 5: Reset Qdrant collections and populate via IngestionPipeline
                if not args.skip_vector_db:
                    await self._reset_qdrant_collections()
                    ingestion = IngestionPipeline()
                    await ingestion.initiate()
                else:
                    logger.info("rebuild.vector_db_skipped_by_flag")

                logger.info("rebuild.completed_successfully")

            except Exception as e:
                logger.error("rebuild.failed", error=str(e))
                raise


def main() -> None:
    asyncio.run(RebuildKnowledgeBasePipeline().initiate())


if __name__ == "__main__":
    main()
