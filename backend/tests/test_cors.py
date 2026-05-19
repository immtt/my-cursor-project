import importlib

from fastapi.testclient import TestClient


def test_documented_frontend_origin_can_call_api(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    main = importlib.import_module("app.main")
    client = TestClient(main.app)

    response = client.options(
        "/api/compare/run",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
