from src.pipeline.ingestion_pipeline import IngestionPipeline


async def process_file(file_path: str) -> bool:
    """Process a single document file for ingestion into the vector database."""
    pipeline = IngestionPipeline()
    return await pipeline._process_file(file_path=file_path)
