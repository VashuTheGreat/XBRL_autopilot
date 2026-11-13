from unittest.mock import AsyncMock, patch
import io

@patch("api.routes.ingestion_router.process_file", new_callable=AsyncMock)
def test_pass_ingest(mock_process_file, client):
    mock_process_file.return_value = True
    response = client.post(
        "/api/v1/ingest",
        headers={"x-ingestion-password": "aloo"},
        files={"file": ("sample.txt", io.BytesIO(b"dummy file content"), "text/plain")},
    )

    assert response.status_code == 200


def test_failed_ingest_no_password(client):
    response = client.post(
        "/api/v1/ingest",
        files={"file": ("sample.txt", io.BytesIO(b"dummy file content"), "text/plain")},
    )
    assert response.status_code == 401


def test_failed_ingest(client):
    response = client.post(
        "/api/v1/ingest",
        headers={"x-ingestion-password": "aloo"},
        files=None,
    )

    assert response.status_code == 400
