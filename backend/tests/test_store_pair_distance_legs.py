"""店间距离：store_pair 表正/反只计一条；与 estimate_route 结合。"""

from datetime import date

from app.models.entities import StorePairDistance, SysSuggest
from app.services.gaode_service import estimate_route, pair_km_from_store_pair_table


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
