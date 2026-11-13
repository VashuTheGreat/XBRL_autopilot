from types import SimpleNamespace
from unittest.mock import patch

import pytest
import pymupdf

from langchain_core.documents import Document
from src.ingestion.loaders import html, office, pdf, text


@pytest.mark.asyncio
async def test_pdf_loader(tmp_path):
    pdf_path = tmp_path / "sample.pdf"
    pdf_document = pymupdf.open()
    page = pdf_document.new_page()
    page.insert_text((72, 72), "PDF loader fixture")
    pdf_document.save(pdf_path)
    pdf_document.close()

    documents: list[Document] = await pdf.pdf_loader(file_path=str(pdf_path))
    assert documents
    assert "PDF loader fixture" in documents[0].page_content

@pytest.mark.asyncio
async def test_text_loader(tmp_path):
    text_path = tmp_path / "sample.txt"
    text_path.write_text("Text loader fixture", encoding="utf-8")

    documents: list[Document] = await text.text_loader(file_path=str(text_path))
    assert documents
    assert documents[0].page_content == "Text loader fixture"



@pytest.mark.asyncio
async def test_html_loader(tmp_path):
    html_path = tmp_path / "sample.html"
    html_path.write_text("<html><body><p>HTML loader fixture</p></body></html>", encoding="utf-8")

    documents: list[Document] = await html.html_loader(file_path=str(html_path))
    assert documents
    assert documents[0].page_content == "HTML loader fixture"


@pytest.mark.asyncio
async def test_office_loader(tmp_path):
    office_path = tmp_path / "sample.docx"
    office_path.write_bytes(b"office parser is mocked")

    with patch(
        "src.ingestion.loaders.office.partition",
        return_value=[SimpleNamespace(text="Office loader fixture")],
    ) as mock_partition:
        documents: list[Document] = await office.office_loader(file_path=str(office_path))

    assert documents
    assert documents[0].page_content == "Office loader fixture"
    mock_partition.assert_called_once_with(filename=str(office_path))