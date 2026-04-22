import json
import os
import tempfile
from datetime import date

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app
from app.models.entities import ManualRoute, SysSuggest
from app.services.gaode_service import backfill_manual_routes_by_batch
from app.services.import_service import (
    fetch_active_import_page,
    fetch_import_batch_page,
    fetch_import_batch_rows,
    import_excel,
)


def _create_system_excel(path: str, volume: float):
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "车辆类型",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ]
    )
    ws.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", "4.2米标箱", volume, "70%", 30, 60])
    wb.save(path)


def _create_system_excel_many(path: str, n: int):
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "车辆类型",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ]
    )
    for i in range(n):
        ws.append(
            [
                "2026-04-20",
                f"SYS{i:03d}",
                "线路A",
                "仓库1",
                "门店甲",
                "4.2米标箱",
                float(i + 1),
                "70%",
                30,
                60,
            ]
        )
    wb.save(path)


def _create_system_excel_three_dates(path: str):
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "车辆类型",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ]
    )
    rows = [
        ["2026-04-18", "D1", "线路A", "仓库1", "门店甲", "4.2米标箱", 1.0, "70%", 30, 60],
        ["2026-04-20", "D2", "线路A", "仓库1", "门店甲", "4.2米标箱", 2.0, "70%", 30, 60],
        ["2026-04-25", "D3", "线路A", "仓库1", "门店甲", "4.2米标箱", 3.0, "70%", 30, 60],
    ]
    for r in rows:
        ws.append(r)
    wb.save(path)


def test_import_upserts_same_waybill_and_route_date(db_session):
    file_a = os.path.join(tempfile.gettempdir(), "sys_a.xlsx")
    file_b = os.path.join(tempfile.gettempdir(), "sys_b.xlsx")
    _create_system_excel(file_a, 8.0)
    _create_system_excel(file_b, 9.0)

    import_excel(db_session, "system", file_a, operator="u1")
    import_excel(db_session, "system", file_b, operator="u1")

    rows = db_session.query(SysSuggest).filter(SysSuggest.route_date == date(2026, 4, 20)).all()
    active_rows = [r for r in rows if r.is_active == 1]
    assert len(rows) == 1
    assert len(active_rows) == 1
    assert active_rows[0].volume == 9.0


def test_fetch_import_batch_rows_matches_import_batch(db_session):
    path = os.path.join(tempfile.gettempdir(), "sys_rows.xlsx")
    _create_system_excel(path, 10.5)
    out = import_excel(db_session, "system", path, operator="t")
    bid = out["batch_id"]
    rows = fetch_import_batch_rows(db_session, "system", bid)
    assert len(rows) == 1
    assert rows[0]["waybill_no"] == "SYS001"
    assert rows[0]["volume"] == 10.5
    assert rows[0]["route_date"] == "2026-04-20"


def test_fetch_import_batch_page_paginates(db_session):
    path = os.path.join(tempfile.gettempdir(), "sys_page.xlsx")
    _create_system_excel_many(path, 25)
    out = import_excel(db_session, "system", path, operator="t")
    bid = out["batch_id"]
    p1 = fetch_import_batch_page(db_session, "system", bid, 1, 20)
    assert p1["total"] == 25
    assert p1["page"] == 1
    assert p1["page_size"] == 20
    assert len(p1["items"]) == 20
    assert p1["items"][0]["waybill_no"] == "SYS000"
    p2 = fetch_import_batch_page(db_session, "system", bid, 2, 20)
    assert len(p2["items"]) == 5
    assert p2["items"][0]["waybill_no"] == "SYS020"
    p50 = fetch_import_batch_page(db_session, "system", bid, 1, 50)
    assert len(p50["items"]) == 25


def test_fetch_import_batch_page_invalid_page_size(db_session):
    path = os.path.join(tempfile.gettempdir(), "sys_one.xlsx")
    _create_system_excel(path, 1.0)
    out = import_excel(db_session, "system", path, operator="t")
    bid = out["batch_id"]
    with pytest.raises(ValueError, match="page_size"):
        fetch_import_batch_page(db_session, "system", bid, 1, 10)


def test_api_import_batch_rejects_bad_page_size():
    client = TestClient(app)
    r = client.get(
        "/api/import-batch",
        params={"dataset_type": "system", "batch_id": "x", "page_size": 10},
    )
    assert r.status_code == 400


def _create_system_excel_two_warehouses_same_date(path: str):
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "车辆类型",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ]
    )
    ws.append(["2026-04-20", "W1", "线路A", "华东仓", "门店甲", "4.2米标箱", 1.0, "70%", 30, 60])
    ws.append(["2026-04-20", "W2", "线路A", "华北仓", "门店甲", "4.2米标箱", 2.0, "70%", 30, 60])
    wb.save(path)


def test_fetch_active_import_page_filters_by_route_date(db_session):
    path = os.path.join(tempfile.gettempdir(), "sys_dates.xlsx")
    _create_system_excel_three_dates(path)
    import_excel(db_session, "system", path, operator="t")
    mid = fetch_active_import_page(
        db_session, "system", date(2026, 4, 19), date(2026, 4, 21), 1, 20
    )
    assert mid["total"] == 1
    assert mid["items"][0]["waybill_no"] == "D2"
    single = fetch_active_import_page(
        db_session, "system", date(2026, 4, 18), date(2026, 4, 18), 1, 20
    )
    assert single["total"] == 1
    assert single["items"][0]["waybill_no"] == "D1"
    full = fetch_active_import_page(
        db_session, "system", date(2026, 4, 1), date(2026, 4, 30), 1, 50
    )
    assert full["total"] == 3


def test_fetch_active_import_page_filters_by_warehouse_and_lists_options(db_session):
    path = os.path.join(tempfile.gettempdir(), "sys_two_wh.xlsx")
    _create_system_excel_two_warehouses_same_date(path)
    import_excel(db_session, "system", path, operator="t")
    full = fetch_active_import_page(
        db_session, "system", date(2026, 4, 1), date(2026, 4, 30), 1, 20
    )
    assert set(full["warehouse_options"]) == {"华东仓", "华北仓"}
    east = fetch_active_import_page(
        db_session,
        "system",
        date(2026, 4, 1),
        date(2026, 4, 30),
        1,
        20,
        warehouse_name="华东仓",
    )
    assert east["total"] == 1
    assert east["items"][0]["waybill_no"] == "W1"


def test_fetch_active_import_page_rejects_inverted_range(db_session):
    with pytest.raises(ValueError, match="route_date_from"):
        fetch_active_import_page(
            db_session, "system", date(2026, 4, 25), date(2026, 4, 20), 1, 20
        )


def test_api_import_active_rejects_inverted_dates():
    client = TestClient(app)
    r = client.get(
        "/api/import-active",
        params={
            "dataset_type": "system",
            "route_date_from": "2026-04-25",
            "route_date_to": "2026-04-20",
            "page": 1,
            "page_size": 20,
        },
    )
    assert r.status_code == 400


def _create_manual_excel(path: str):
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "车辆类型",
            "配送体积",
            "装载率",
        ]
    )
    ws.append(["2026-04-22", "M001", "线路A", "仓库1", "门店甲", "4.2米标箱", 4.0, "70%"])
    wb.save(path)


def test_backfill_manual_routes_by_batch_sets_estimates(db_session):
    path = os.path.join(tempfile.gettempdir(), "manual_est.xlsx")
    _create_manual_excel(path)
    out = import_excel(db_session, "manual", path, operator="t")
    bid = out["batch_id"]
    row = db_session.query(ManualRoute).filter(ManualRoute.batch_id == bid).first()
    assert row is not None
    assert row.calc_status == 0
    res = backfill_manual_routes_by_batch(db_session, bid)
    db_session.refresh(row)
    assert res["updated"] == 1
    assert res["failed"] == 0
    assert row.est_distance is not None
    assert row.est_duration is not None
    assert row.calc_status == 1
    assert row.delivery_store_order
    assert json.loads(row.delivery_store_order) == ["门店甲"]


def test_api_manual_backfill_unknown_batch_returns_zero():
    client = TestClient(app)
    r = client.post("/api/manual/backfill", json={"batch_id": "__no_such_batch__"})
    assert r.status_code == 200
    data = r.json()
    assert data["updated"] == 0
    assert data["failed"] == 0
    assert data["failures"] == []


def test_api_manual_backfill_rejects_neither_batch_nor_range():
    client = TestClient(app)
    r = client.post("/api/manual/backfill", json={})
    assert r.status_code == 422


def test_api_manual_backfill_by_date_range_updates_zero_when_empty():
    client = TestClient(app)
    r = client.post(
        "/api/manual/backfill",
        json={"route_date_from": "2099-01-01", "route_date_to": "2099-01-31"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["updated"] == 0
    assert data["failed"] == 0
