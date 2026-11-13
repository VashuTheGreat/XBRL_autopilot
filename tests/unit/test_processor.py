from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from src.ingestion.processor import process_file


TEXT_FILE_PATH = "data/tests/text.txt"
@pytest.mark.asyncio
@patch("src.ingestion.processor.vector_store_module.get_client")
async def test_process_file(mock_get_client, tmp_path):
    """Test for ingesting file"""
    mock_client = MagicMock()
    mock_client.upsert = AsyncMock(return_value=True)
    mock_get_client.return_value = mock_client

    text_file = tmp_path / "sample.txt"
    text_file.write_text("Processor test fixture", encoding="utf-8")

    value = await process_file(file_path=str(text_file))
    assert value == True
