"""Exact store/warehouse names must not inherit a similar store_coordinate row."""

from datetime import date

from app.models.entities import AddressCache, ManualRoute, StoreCoordinate
from app.services.gaode_service import (
    _mock_geocode,
    backfill_manual_routes,
    get_or_create_coord,
    resolve_lnglat_for_manual,
)


EAST_NAME = "好想来南京东路店"
WEST_NAME = "好想来南京西路店"
EAST_LNG, EAST_LAT = 121.48, 31.23
WEST_CACHE_LNG, WEST_CACHE_LAT = 121.0, 31.0


def _seed_east_store(db):
    db.add(StoreCoordinate(store_name=EAST_NAME, longitude=EAST_LNG, latitude=EAST_LAT))
    db.commit()


def test_resolve_uses_own_cache_instead_of_similar_store(db_session):
    _seed_east_store(db_session)
    db_session.add(
        AddressCache(
            address_name=WEST_NAME,
            address_type="store",
            longitude=WEST_CACHE_LNG,
            latitude=WEST_CACHE_LAT,
        )
    )
    db_session.commit()

    xy = resolve_lnglat_for_manual(db_session, WEST_NAME, kind="store")
    assert abs(xy[0] - WEST_CACHE_LNG) < 1e-6
    assert abs(xy[1] - WEST_CACHE_LAT) < 1e-6


def test_resolve_missing_store_uses_own_geocode_not_neighbor(db_session):
    _seed_east_store(db_session)

    xy = resolve_lnglat_for_manual(db_session, WEST_NAME, kind="store")
    expected = _mock_geocode(WEST_NAME)
    assert xy == expected
    assert abs(xy[0] - EAST_LNG) > 1e-3


def test_get_or_create_coord_store_does_not_substitute_similar_name(db_session):
    _seed_east_store(db_session)

    xy = get_or_create_coord(db_session, WEST_NAME, "store")
    assert xy == _mock_geocode(WEST_NAME)


def test_resolve_warehouse_does_not_use_similar_store(db_session):
    db_session.add(
        StoreCoordinate(
            store_name="上海浦东仓配中心店",
            longitude=121.5,
            latitude=31.2,
        )
    )
    db_session.commit()

    xy = resolve_lnglat_for_manual(db_session, "上海浦东仓", kind="warehouse")
    assert xy == _mock_geocode("上海浦东仓")
    assert abs(xy[0] - 121.5) > 1e-3


def test_resolve_still_uses_exact_store_coordinate(db_session):
    _seed_east_store(db_session)

    xy = resolve_lnglat_for_manual(db_session, EAST_NAME, kind="store")
    assert abs(xy[0] - EAST_LNG) < 1e-6
    assert abs(xy[1] - EAST_LAT) < 1e-6


def test_backfill_does_not_overwrite_cache_with_similar_store(db_session):
    _seed_east_store(db_session)
    db_session.add(
        AddressCache(
            address_name=WEST_NAME,
            address_type="store",
            longitude=WEST_CACHE_LNG,
            latitude=WEST_CACHE_LAT,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 9, 12),
            waybill_no="WB-WEST",
            route_line="L1",
            warehouse_name="测试仓",
            stores=WEST_NAME,
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            is_active=1,
            batch_id="b-west",
        )
    )
    db_session.commit()

    backfill_manual_routes(db_session, date(2026, 9, 12))

    ac = (
        db_session.query(AddressCache)
        .filter(AddressCache.address_name == WEST_NAME)
        .one()
    )
    assert abs(ac.longitude - EAST_LNG) > 1e-3
    assert abs(ac.longitude - WEST_CACHE_LNG) < 1e-6
    assert abs(ac.latitude - WEST_CACHE_LAT) < 1e-6
