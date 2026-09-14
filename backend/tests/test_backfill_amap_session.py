"""AMap HTTP failures must not session.rollback() other pending backfill writes."""

from datetime import date
from unittest.mock import patch

import httpx

from app.models.entities import AddressCache, ManualRoute
from app.services.gaode_service import (
    backfill_manual_routes_by_date_window,
    resolve_lnglat_for_manual,
)


def _manual(**kwargs) -> ManualRoute:
    defaults = dict(
        route_date=date(2026, 4, 21),
        route_line="L",
        warehouse_name="仓A",
        vehicle_type="4.2米",
        volume=1.0,
        load_rate=50.0,
        is_active=1,
        batch_id="b1",
        calc_status=0,
    )
    defaults.update(kwargs)
    return ManualRoute(**defaults)


def test_amap_timeout_does_not_discard_pending_manual_estimate(db_session):
    """
    Concrete trigger: AMAP_KEY path times out while another ManualRoute already has
    uncommitted est_distance/calc_status on the same Session (backfill loop).
    rollback() would expire that row and drop the writes.
    """
    row = _manual(waybill_no="M-pending", stores="店甲")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    row.est_distance = 12.5
    row.est_duration = 40
    row.calc_status = 1

    def boom(*_a, **_k):
        raise httpx.TimeoutException("amap timeout")

    with patch("app.services.gaode_service.amap_rest_enabled", return_value=True), patch(
        "app.services.gaode_service._amap_get", side_effect=boom
    ):
        lng, lat = resolve_lnglat_for_manual(db_session, "全新未缓存门店", kind="store")

    assert isinstance(lng, float) and isinstance(lat, float)
    assert row.est_distance == 12.5
    assert row.est_duration == 40
    assert row.calc_status == 1

    db_session.commit()
    db_session.expire_all()
    persisted = db_session.get(ManualRoute, row.id)
    assert persisted.est_distance == 12.5
    assert persisted.calc_status == 1


def test_backfill_keeps_cached_route_when_later_amap_geocode_times_out(db_session):
    """
    Route 1 warehouse+store already in address_cache so its estimate stays dirty
    until the loop-end commit. Route 2 has a new store: AMap times out, then mock.
    """
    d = date(2026, 4, 21)
    db_session.add(
        AddressCache(
            address_name="仓A",
            address_type="warehouse",
            longitude=117.0,
            latitude=31.6,
        )
    )
    db_session.add(
        AddressCache(
            address_name="店甲",
            address_type="store",
            longitude=117.1,
            latitude=31.7,
        )
    )
    r1 = _manual(waybill_no="M1", stores="店甲", route_date=d)
    r2 = _manual(waybill_no="M2", stores="店乙-新店", route_date=d)
    db_session.add_all([r1, r2])
    db_session.commit()
    id1, id2 = r1.id, r2.id

    def boom(*_a, **_k):
        raise httpx.TimeoutException("amap timeout")

    with patch("app.services.gaode_service.amap_rest_enabled", return_value=True), patch(
        "app.services.gaode_service._amap_get", side_effect=boom
    ):
        result = backfill_manual_routes_by_date_window(db_session, d, d)

    assert result["failed"] == 0
    assert result["updated"] == 2
    db_session.expire_all()
    row1 = db_session.get(ManualRoute, id1)
    row2 = db_session.get(ManualRoute, id2)
    assert row1.calc_status == 1
    assert row1.est_distance is not None
    assert row2.calc_status == 1
    assert row2.est_distance is not None
