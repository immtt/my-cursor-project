import os
import tempfile

os.environ.setdefault("AUTH_JWT_SECRET", "test-jwt-secret-for-pytest")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app.api.deps_auth import verify_bearer_token
from app.db.session import Base
from app.main import _core


def _make_verify_bearer_bypass(user_id: int = 1):
    def _inner(request: Request) -> None:
        if request.method == "OPTIONS":
            return
        request.state.user_id = user_id

    return _inner


@pytest.fixture
def client_api_authed() -> TestClient:
    _core.dependency_overrides[verify_bearer_token] = _make_verify_bearer_bypass(1)
    with TestClient(_core) as c:
        yield c
    _core.dependency_overrides.clear()


@pytest.fixture
def db_session():
    db_file = os.path.join(tempfile.gettempdir(), "smart_route_test.db")
    if os.path.exists(db_file):
        os.remove(db_file)
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        if os.path.exists(db_file):
            os.remove(db_file)
