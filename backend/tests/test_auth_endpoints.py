from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import _core
from app.models.entities import AppUser
from app.services.auth_service import hash_password, maybe_bootstrap_first_admin, verify_password


def test_business_api_returns_401_without_token():
    with TestClient(_core) as c:
        r = c.get("/api/import-template", params={"dataset_type": "system"})
    assert r.status_code == 401
    assert r.json().get("detail")


def test_bootstrap_seeds_first_admin_user(db_session, monkeypatch):
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USER", "root_admin")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASS", "root_secret_x")
    maybe_bootstrap_first_admin(db_session)
    u = db_session.query(AppUser).filter_by(username="root_admin").one()
    assert u.is_active and u.is_admin
    assert verify_password("root_secret_x", u.password_hash)


def test_bootstrap_does_nothing_if_users_exist(db_session, monkeypatch):
    db_session.add(
        AppUser(
            username="existing",
            password_hash=hash_password("x"),
            is_active=True,
            is_admin=True,
        )
    )
    db_session.commit()
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USER", "newboot")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASS", "any")
    maybe_bootstrap_first_admin(db_session)
    assert db_session.query(AppUser).count() == 1


def test_auth_login_and_me(db_session):
    db_session.add(
        AppUser(
            username="me_user",
            password_hash=hash_password("secret99"),
            is_active=True,
            is_admin=False,
        )
    )
    db_session.commit()

    def _get_db():
        yield db_session

    _core.dependency_overrides[get_db] = _get_db
    try:
        with TestClient(_core) as c:
            r = c.post("/api/auth/login", json={"username": "me_user", "password": "secret99"})
            assert r.status_code == 200
            body = r.json()
            assert body.get("access_token")
            assert body.get("user", {}).get("username") == "me_user"
            tok = body["access_token"]
            m = c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
            assert m.status_code == 200
            assert m.json()["username"] == "me_user"
    finally:
        _core.dependency_overrides.clear()


def test_admin_creates_user(db_session):
    db_session.add(
        AppUser(
            username="admin1",
            password_hash=hash_password("ap1"),
            is_active=True,
            is_admin=True,
        )
    )
    db_session.commit()

    def _get_db():
        yield db_session

    _core.dependency_overrides[get_db] = _get_db
    try:
        with TestClient(_core) as c:
            r = c.post("/api/auth/login", json={"username": "admin1", "password": "ap1"})
            assert r.status_code == 200
            tok = r.json()["access_token"]
            h = {"Authorization": f"Bearer {tok}"}
            r2 = c.post(
                "/api/admin/users",
                headers=h,
                json={
                    "username": "jane",
                    "password": "jpw",
                    "is_active": True,
                    "is_admin": False,
                },
            )
            assert r2.status_code == 200
            assert r2.json()["username"] == "jane"
    finally:
        _core.dependency_overrides.clear()


def test_non_admin_cannot_list_users(db_session):
    db_session.add(
        AppUser(
            username="plain",
            password_hash=hash_password("pp"),
            is_active=True,
            is_admin=False,
        )
    )
    db_session.commit()

    def _get_db():
        yield db_session

    _core.dependency_overrides[get_db] = _get_db
    try:
        with TestClient(_core) as c:
            r = c.post("/api/auth/login", json={"username": "plain", "password": "pp"})
            tok = r.json()["access_token"]
            r2 = c.get(
                "/api/admin/users",
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert r2.status_code == 403
    finally:
        _core.dependency_overrides.clear()
