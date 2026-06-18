from fastapi.testclient import TestClient

from app.main import app


def test_cors_allows_documented_frontend_origin():
    client = TestClient(app)
    origin = "http://127.0.0.1:5173"

    response = client.options(
        "/api/compare/overview?route_date=2026-04-20",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
