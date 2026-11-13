import os
import sys
from typing import List

from langchain_core.documents import Document

from src.constants import (
    AGENT_KNOWLEDGE_DATA_DIR,
    BATCH_SIZE,
    CI_OUTPUT_JSON,
    CI_TAXONOMY_VDB,
    COST_OUTPUT_JSON,
    COST_TAXONOMY_VDB,
    INDAS_OUTPUT_JSON,
    IND_AS_TAXONOMY_VDB,
    XBRL_AGENT_VDB,
)
from src.core.exception import MyException
from src.core.logger import logger
from src.ingestion.chunking.splitter import split
from src.ingestion.loaders import html, office, pdf, text
from src.ingestion.operations.store_taxonomies import StoreTaxonomies
from src.services.vectordb.qdrant import get_qdrant_service
from src.utils.main_utils import load_json, to_chroma_metadata
from .base import Pipeline


class IngestionPipeline(Pipeline):
    def __init__(self):
        pass

    def _map_file_type(self, file_path: str):
        ext = file_path.split(".")[-1].lower() if "." in file_path else ""
        logger.debug("ingestion.map_file_type", file_path=file_path, extension=ext)
        match ext:
            case "pdf":
                return pdf.pdf_loader
            case "txt" | "md":
                return text.text_loader
            case "html" | "htm":
                return html.html_loader
            case "docx" | "doc" | "ppt" | "pptx" | "word":
                return office.office_loader
            case _:
                return text.text_loader

    async def _process_file(self, file_path: str) -> bool:
        """Process a single document file, split into chunks, and upsert into the xbrl_agent collection."""
        with logger.span("ingestion.process_file", file_path=file_path):
            try:
                logger.info("ingestion.reading_file", file_path=file_path)
                loader = self._map_file_type(file_path=file_path)
                documents = await loader(file_path=file_path)
                if not documents:
                    logger.warning("ingestion.file_empty", file_path=file_path)
                    return True

                chunks = split(documents)
                if not chunks:
                    logger.warning("ingestion.no_chunks_generated", file_path=file_path)
                    return True

                agent_store = get_qdrant_service(collection_name=XBRL_AGENT_VDB)
                await agent_store.aadd(chunks)
                logger.info(
                    "ingestion.file_upserted",
                    file_path=file_path,
                    chunks_count=len(chunks),
                    collection=XBRL_AGENT_VDB,
                )
                return True
            except Exception as e:
                logger.error("ingestion.file_processing_failed", file_path=file_path, error=str(e))
                raise MyException(e, sys)

    async def _process_folder(self, folder_path: str = str(AGENT_KNOWLEDGE_DATA_DIR)) -> List[bool]:
        """Traverse folder and process all documentation files into the xbrl_agent collection."""
        with logger.span("ingestion.process_folder", folder_path=folder_path):
            try:
                logger.info("ingestion.traversing_folder", folder_path=folder_path)
                results = []
                if not os.path.exists(folder_path):
                    logger.warning("ingestion.folder_not_found", folder_path=folder_path)
                    return results

                for root, _, files in os.walk(folder_path):
                    for file in sorted(files):
                        file_path = os.path.join(root, file)
                        if os.path.getsize(file_path) == 0:
                            logger.info("ingestion.skipping_empty_file", file_path=file_path)
                            continue
                        res = await self._process_file(file_path=file_path)
                        results.append(res)

                logger.info("ingestion.folder_completed", folder_path=folder_path, processed_files=len(results))
                return results
            except Exception as e:
                logger.error("ingestion.folder_processing_failed", folder_path=folder_path, error=str(e))
                raise MyException(e, sys)

    async def _load_taxonomies(self, path: str) -> List[Document]:
        """Load extracted concepts from JSON and format into Documents with metadata."""
        data = await load_json(path=path)
        taxonomies: List[Document] = []
        concepts = data.get("concepts", {})
        for qname, c in concepts.items():
            label = (c.get("labels", {}) or {}).get("label", "") or ""
            name = c.get("name") or ""
            doc_entry = f"{label} | {qname} | {name}"
            meta = to_chroma_metadata(c)
            taxonomies.append(Document(page_content=doc_entry, metadata=meta))

        logger.info("ingestion.taxonomies_loaded", path=str(path), count=len(taxonomies))
        return taxonomies

    async def _ingest_collection(self, name: str, collection_key: str, items: List[Document]) -> None:
        """Ingest document list into the target Qdrant collection in batches."""
        logger.info("ingestion.starting_collection", taxonomy=name, collection=collection_key, total=len(items))
        for i in range(0, len(items), BATCH_SIZE):
            batch = items[i : i + BATCH_SIZE]
            await StoreTaxonomies(taxonomies=batch, collection=collection_key)
            logger.info(
                "ingestion.batch_progress",
                taxonomy=name,
                collection=collection_key,
                progress=f"{min(i + BATCH_SIZE, len(items))}/{len(items)}",
            )
        logger.info("ingestion.collection_completed", taxonomy=name, collection=collection_key, total=len(items))

    async def initiate(self) -> None:
        """Run complete taxonomy and documentation ingestion pipeline into Qdrant."""
        with logger.span("ingestion_pipeline.initiate"):
            logger.info("ingestion_pipeline.started")

            # 1. C&I Taxonomy
            ci_items = await self._load_taxonomies(str(CI_OUTPUT_JSON))
            await self._ingest_collection("C&I Taxonomy 2016", CI_TAXONOMY_VDB, ci_items)

            # 2. IND-AS Taxonomy
            ind_as_items = await self._load_taxonomies(str(INDAS_OUTPUT_JSON))
            await self._ingest_collection("IND-AS Taxonomy", IND_AS_TAXONOMY_VDB, ind_as_items)

            # 3. Costing Taxonomy
            costing_items = await self._load_taxonomies(str(COST_OUTPUT_JSON))
            await self._ingest_collection("Costing Taxonomy", COST_TAXONOMY_VDB, costing_items)

            # 4. Agent MCA/XBRL Documentation
            await self._process_folder(str(AGENT_KNOWLEDGE_DATA_DIR))

            logger.info("ingestion_pipeline.all_completed_successfully")
