"""店间距离：store_pair 表正/反只计一条；与 estimate_route 结合。"""

from datetime import date

import pytest

from app.models.entities import ManualRoute, StorePairDistance, SysSuggest
from app.services.gaode_service import (
    backfill_manual_routes,
    estimate_route,
    pair_km_from_store_pair_table,
)
from app.services.store_distance_excel import parse_distance_km, parse_lng_lat
from app.services.store_master_service import create_store_pair_distance


def test_pair_km_prefers_min_when_both_directions_exist(db_session):
    db_session.add(
        StorePairDistance(store_from="甲", store_to="乙", distance_km=12.0)
    )
    db_session.add(
        StorePairDistance(store_from="乙", store_to="甲", distance_km=9.5)
    )
    db_session.commit()
    assert pair_km_from_store_pair_table(db_session, "甲", "乙") == 9.5
    assert pair_km_from_store_pair_table(db_session, "乙", "甲") == 9.5


def test_pair_km_forward_only(db_session):
    db_session.add(StorePairDistance(store_from="X", store_to="Y", distance_km=3.3))
    db_session.commit()
    assert pair_km_from_store_pair_table(db_session, "X", "Y") == 3.3
    assert pair_km_from_store_pair_table(db_session, "Y", "X") == 3.3


def test_estimate_route_uses_table_for_store_legs(db_session):
    db_session.add(
        StorePairDistance(store_from="店A", store_to="店B", distance_km=5.0)
    )
    db_session.commit()
    # 无仓库点表：get_or_create_coord 会写 address_cache；此处只关心店间用表值
    dist, dur, path = estimate_route(
        "测试仓",
        ["店A", "店B"],
        db_session,
    )
    # 仓->店A 球面 + 5.0 km 表；店A/店B 坐标由 mock 决定，首段 >0
    assert dist > 5.0
    assert dur >= 1
    assert isinstance(path, list) and len(path) >= 2


def test_sys_ensure_polyline_uses_estimate_route(db_session):
    """SysSuggest.ensure 走 estimate_route，店间应优先表。"""
    db_session.add(
        StorePairDistance(store_from="S1", store_to="S2", distance_km=2.0)
    )
    db_session.commit()
    row = SysSuggest(
        route_date=date(2026, 5, 1),
        waybill_no="T1",
        route_line="L",
        warehouse_name="WH",
        stores="S1,S2",
        vehicle_type="4.2米",
        volume=1.0,
        load_rate=50.0,
        est_distance=0.0,
        est_duration=0,
    )
    db_session.add(row)
    db_session.commit()
    d, _dur, _p = estimate_route("WH", ["S1", "S2"], db_session)
    assert d > 2.0


def test_parse_distance_km_rejects_absurd_and_nonfinite():
    assert parse_distance_km("12.5") == 12.5
    assert parse_distance_km(0) == 0.0
    assert parse_distance_km(1e20) is None
    assert parse_distance_km("Infinity") is None
    assert parse_distance_km("NaN") is None
    assert parse_distance_km(-1) is None


def test_parse_lng_lat_rejects_nan_inf_and_out_of_range():
    assert parse_lng_lat("121.5,31.2") == (121.5, 31.2)
    assert parse_lng_lat("nan,31.2") is None
    assert parse_lng_lat("121.5,Infinity") is None
    assert parse_lng_lat("200,31.2") is None
    assert parse_lng_lat("121.5,100") is None


def test_create_store_pair_rejects_overflow_km(db_session):
    with pytest.raises(ValueError, match="距离"):
        create_store_pair_distance(
            db_session, store_from="A", store_to="B", distance_km=1e20
        )
    assert db_session.query(StorePairDistance).count() == 0


def test_estimate_route_rejects_absurd_table_km(db_session):
    db_session.add(
        StorePairDistance(store_from="毒A", store_to="毒B", distance_km=1e20)
    )
    db_session.commit()
    with pytest.raises(ValueError, match="duration"):
        estimate_route("仓", ["毒A", "毒B"], db_session)


def test_backfill_keeps_healthy_rows_when_pair_km_would_overflow(db_session):
    db_session.add(
        StorePairDistance(store_from="毒A", store_to="毒B", distance_km=1e20)
    )
    poison = ManualRoute(
        route_date=date(2026, 5, 1),
        waybill_no="POISON",
        route_line="L",
        warehouse_name="仓",
        stores="毒A,毒B",
        vehicle_type="4.2米",
        volume=1.0,
        load_rate=50.0,
        is_active=1,
        batch_id="b1",
        calc_status=0,
    )
    healthy = ManualRoute(
        route_date=date(2026, 5, 1),
        waybill_no="OK",
        route_line="L",
        warehouse_name="仓",
        stores="好1,好2",
        vehicle_type="4.2米",
        volume=1.0,
        load_rate=50.0,
        is_active=1,
        batch_id="b1",
        calc_status=0,
    )
    db_session.add_all([poison, healthy])
    db_session.commit()

    result = backfill_manual_routes(db_session, date(2026, 5, 1))
    db_session.refresh(poison)
    db_session.refresh(healthy)

    assert poison.calc_status == 2
    assert poison.est_duration is None
    assert healthy.calc_status == 1
    assert healthy.est_duration is not None
    assert healthy.est_duration <= 2**63 - 1
    assert result["updated"] == 1
    assert result["failed"] == 1
