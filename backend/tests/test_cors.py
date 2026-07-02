from fastapi.testclient import TestClient

from app.main import app


def test_documented_frontend_origin_can_preflight_api():
    client = TestClient(app)

    response = client.options(
        "/api/compare/overview",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
