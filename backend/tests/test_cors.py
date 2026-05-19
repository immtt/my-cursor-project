import importlib
import sys

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app.db import session as db_session_module


def test_documented_frontend_origin_can_call_api(tmp_path, monkeypatch):
    test_engine = create_engine(f"sqlite:///{tmp_path / 'smart_route.db'}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(db_session_module, "engine", test_engine)
    sys.modules.pop("app.main", None)

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
