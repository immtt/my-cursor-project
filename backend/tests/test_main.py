from fastapi.testclient import TestClient

from app.main import app


def test_local_frontend_origin_is_allowed_for_api_preflight():
    client = TestClient(app)

    response = client.options(
        "/api/compare/overview?route_date=2026-04-20",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
