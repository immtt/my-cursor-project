"""import_dedupe：去重与业务唯一性。"""

from datetime import date, datetime

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateTable

import app.models.entities  # noqa: F401
from app.db.import_dedupe import (
    apply_unique_indexes_route_waybill,
    dedupe_compare_result,
    dedupe_import_tables_and_apply_unique,
    dedupe_manual_route,
    dedupe_sys_suggest,
)
from app.db.session import Base
from app.models.entities import (
    CompareResult,
    GaodeCalcFailureLog,
    ManualRoute,
    SysSuggest,
)


def _recreate_table_without_route_waybill_unique(db, engine, model_cls) -> None:
    """用于插入重复 (route_date, waybill) 的测试数据：无唯一约束的表体。"""
    s = str(CreateTable(model_cls.__table__).compile(dialect=sqlite.dialect()))
    s = s.replace(
        ", \n\tCONSTRAINT %s UNIQUE (route_date, waybill_no)" % model_cls.__table_args__[0].name,
        "",
    )
    db.execute(text("DROP TABLE IF EXISTS %s" % model_cls.__tablename__))
    db.execute(text(s))
    db.commit()


@pytest.fixture
def mem_session():
    eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=eng)
    S = sessionmaker(bind=eng, autocommit=False, autoflush=False)
    db = S()
    try:
        yield db, eng
    finally:
        db.close()


def test_dedupe_sys_suggest_removes_extra_and_points_compare_result(mem_session):
    db, eng = mem_session
    _recreate_table_without_route_waybill_unique(db, eng, SysSuggest)
    d0 = date(2025, 1, 1)
    t_old = datetime(2025, 1, 1, 8, 0, 0)
    t_new = datetime(2025, 1, 2, 8, 0, 0)
    s_old = SysSuggest(
        route_date=d0,
        waybill_no="W1",
        route_line="L1",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
        imported_at=t_old,
    )
    s_new = SysSuggest(
        route_date=d0,
        waybill_no="W1",
        route_line="L1",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
        imported_at=t_new,
    )
    db.add(s_old)
    db.add(s_new)
    db.flush()
    m = ManualRoute(
        route_date=d0,
        waybill_no="M1",
        route_line="L1",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
    )
    db.add(m)
    db.flush()
    c = CompareResult(
        route_date=d0,
        sys_id=s_old.id,
        manual_id=m.id,
        match_status="full",
        store_match_rate=100.0,
        match_score=1.0,
    )
    db.add(c)
    db.commit()
    n = dedupe_sys_suggest(db)
    assert n == 1
    db.commit()
    remaining = db.query(SysSuggest).all()
    assert len(remaining) == 1
    assert remaining[0].id == s_new.id
    db.refresh(c)
    assert c.sys_id == s_new.id


def test_dedupe_manual_route_updates_gaode_log(mem_session):
    db, eng = mem_session
    _recreate_table_without_route_waybill_unique(db, eng, ManualRoute)
    d0 = date(2025, 1, 1)
    t0 = datetime(2025, 1, 1, 0, 0, 0)
    t1 = datetime(2025, 1, 3, 0, 0, 0)
    m0 = ManualRoute(
        route_date=d0,
        waybill_no="M1",
        route_line="L1",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
        imported_at=t0,
    )
    m1 = ManualRoute(
        route_date=d0,
        waybill_no="M1",
        route_line="L1",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
        imported_at=t1,
    )
    db.add_all([m0, m1])
    db.flush()
    g = GaodeCalcFailureLog(
        route_date=d0,
        manual_id=m0.id,
        failed_store="S1",
        reason="x",
    )
    db.add(g)
    db.commit()
    assert dedupe_manual_route(db) == 1
    db.commit()
    db.refresh(g)
    assert g.manual_id == m1.id
    assert db.query(ManualRoute).count() == 1


def test_dedupe_compare_result_keeps_min_id(mem_session):
    db, eng = mem_session
    s = SysSuggest(
        route_date=date(2025, 1, 1),
        waybill_no="S",
        route_line="L",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
    )
    m = ManualRoute(
        route_date=date(2025, 1, 1),
        waybill_no="M",
        route_line="L",
        warehouse_name="W",
        stores="A",
        vehicle_type="v",
        volume=1.0,
        load_rate=1.0,
        est_distance=1.0,
        est_duration=1,
        batch_id="b",
        is_active=1,
    )
    db.add_all([s, m])
    db.flush()
    d = date(2025, 1, 1)
    c1 = CompareResult(
        route_date=d,
        sys_id=s.id,
        manual_id=m.id,
        match_status="full",
        store_match_rate=100.0,
        match_score=1.0,
    )
    c2 = CompareResult(
        route_date=d,
        sys_id=s.id,
        manual_id=m.id,
        match_status="full",
        store_match_rate=50.0,
        match_score=0.5,
    )
    db.add_all([c1, c2])
    db.commit()
    n = dedupe_compare_result(db)
    assert n == 1
    db.commit()
    rows = db.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].id == c1.id


def test_dedupe_import_idempotent_zero_removed(mem_session):
    db, eng = mem_session
    s = dedupe_import_tables_and_apply_unique(eng)
    assert s["sys_suggest_rows_removed"] == 0
    assert s["manual_route_rows_removed"] == 0
    s2 = dedupe_import_tables_and_apply_unique(eng)
    assert s2 == s


def test_apply_unique_noop_when_constraint_from_create_all(mem_session):
    db, eng = mem_session
    insp = inspect(eng)
    before = len(insp.get_unique_constraints("sys_suggest") or [])
    assert before >= 1
    apply_unique_indexes_route_waybill(eng)
    after = insp.get_unique_constraints("sys_suggest") or []
    assert any(u.get("name") == "uq_sys_suggest_route_date_waybill" for u in after)
