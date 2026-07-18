from fastapi.testclient import TestClient

from app.main import app


def test_import_rejects_unsupported_xls_files():
    client = TestClient(app)

    response = client.post(
        "/api/import/system",
        files={"file": ("routes.xls", b"legacy xls content", "application/vnd.ms-excel")},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "only .xlsx files are supported"}
