from fastapi.testclient import TestClient

from app.main import app


def test_allows_documented_frontend_origin_preflight():
    client = TestClient(app)

    response = client.options(
        "/api/compare/run",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
