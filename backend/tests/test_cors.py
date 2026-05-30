from fastapi.testclient import TestClient

from app.main import app


def test_documented_frontend_origin_can_call_api():
    client = TestClient(app)

    resp = client.options(
        "/api/compare/overview?route_date=2026-04-20",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
