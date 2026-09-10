"""Non-finite floats must not persist or crash JSON list/create responses."""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

import app.main as app_main
from app.api.deps_auth import verify_bearer_token
from app.db.session import Base, get_db
from app.models.entities import AppUser, StoreCoordinate
from app.services.auth_service import hash_password
from app.services.store_master_service import create_store_coordinate, list_store_coordinates
from app.utils.finite import parse_finite_or_none, require_lng_lat


def _ephemeral_client():
    db_file = os.path.join(tempfile.gettempdir(), "smart_route_finite_json_test.db")
    if os.path.exists(db_file):
        os.remove(db_file)
    engine = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    TestingLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _get_db():
        db = TestingLocal()
        try:
            yield db
        finally:
            db.close()

    def _verify_bypass(request: Request) -> None:
        if request.method == "OPTIONS":
            return
        request.state.user_id = 1

    app_main._core.dependency_overrides[get_db] = _get_db
    app_main._core.dependency_overrides[verify_bearer_token] = _verify_bypass
    seed = TestingLocal()
    try:
        seed.add(
            AppUser(
                username="finite_e2e",
                password_hash=hash_password("x"),
                is_active=True,
                is_admin=False,
            )
        )
        seed.commit()
    finally:
        seed.close()
    client = TestClient(app_main._core, raise_server_exceptions=False)
    return client, TestingLocal, db_file


def _cleanup(db_file: str) -> None:
    app_main._core.dependency_overrides.clear()
    if os.path.exists(db_file):
        os.remove(db_file)


def _post_raw(client: TestClient, path: str, raw: str):
    return client.post(
        path, content=raw.encode("utf-8"), headers={"Content-Type": "application/json"}
    )


def test_parse_finite_helpers():
    assert parse_finite_or_none(1.5) == 1.5
    assert parse_finite_or_none("12.25") == 12.25
    assert parse_finite_or_none(float("inf")) is None
    assert parse_finite_or_none("Infinity") is None
    assert parse_finite_or_none("1e309") is None
    assert parse_finite_or_none(float("nan")) is None
    with pytest.raises(ValueError):
        require_lng_lat(float("inf"), 31.2)
    with pytest.raises(ValueError):
        require_lng_lat(200.0, 31.2)
    assert require_lng_lat(116.4, 31.2) == (116.4, 31.2)


def test_store_coordinate_api_rejects_overflow_json_number():
    client, TestingLocal, db_file = _ephemeral_client()
    try:
        r = _post_raw(
            client,
            "/api/store-coordinates",
            '{"store_name":"PoisonStore","longitude":1e309,"latitude":31.2}',
        )
        assert r.status_code == 422
        assert "finite" in r.text.lower() or "detail" in r.text
        listed = client.get("/api/store-coordinates")
        assert listed.status_code == 200
        assert listed.json()["total"] == 0
        db = TestingLocal()
        try:
            assert db.query(StoreCoordinate).count() == 0
        finally:
            db.close()

        ok = client.post(
            "/api/store-coordinates",
            json={"store_name": "GoodStore", "longitude": 121.47, "latitude": 31.23},
        )
        assert ok.status_code == 200
        assert ok.json()["longitude"] == pytest.approx(121.47)
    finally:
        _cleanup(db_file)


def test_customer_km_and_warehouse_area_reject_infinity():
    client, _TestingLocal, db_file = _ephemeral_client()
    try:
        r = client.post(
            "/api/customer-profiles",
            json={
                "customer_code": "KINF",
                "customer_name": "InfKm",
                "settlement_warehouse_km": "Infinity",
            },
        )
        assert r.status_code in (400, 422)
        listed = client.get("/api/customer-profiles")
        assert listed.status_code == 200
        assert listed.json()["total"] == 0

        r2 = _post_raw(
            client,
            "/api/warehouse-base",
            '{"warehouse_name":"PoisonWH","group_name":"G","address":"A","brand":"B","area_sqm":1e309}',
        )
        assert r2.status_code in (400, 422)
        listed_wh = client.get("/api/warehouse-base")
        assert listed_wh.status_code == 200
        assert listed_wh.json()["total"] == 0
    finally:
        _cleanup(db_file)


def test_list_store_coordinates_json_survives_existing_inf_row(db_session):
    row = StoreCoordinate(
        store_name="LegacyPoison",
        longitude=float("inf"),
        latitude=31.2,
        data_source="legacy",
    )
    db_session.add(row)
    db_session.commit()

    with pytest.raises(ValueError):
        create_store_coordinate(
            db_session,
            store_name="NewPoison",
            longitude=float("inf"),
            latitude=31.2,
        )

    payload = list_store_coordinates(db_session, skip=0, limit=50)
    assert payload["total"] == 1
    assert payload["items"][0]["store_name"] == "LegacyPoison"
    assert payload["items"][0]["longitude"] is None

    from fastapi.responses import JSONResponse

    JSONResponse(payload)
