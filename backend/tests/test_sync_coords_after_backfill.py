"""补算后冗余经纬度回写 store_coordinate / address_cache。"""

from app.models.entities import AddressCache, StoreCoordinate
from app.services.gaode_service import sync_resolved_lnglat_to_cache_tables


def test_sync_resolved_lnglat_updates_existing_rows(db_session):
    db_session.add(
        StoreCoordinate(
            store_name="门店甲",
            longitude=1.0,
            latitude=2.0,
        )
    )
    db_session.add(
        AddressCache(
            address_name="门店甲",
            address_type="store",
            longitude=1.0,
            latitude=2.0,
        )
    )
    db_session.add(
        AddressCache(
            address_name="仓A",
            address_type="warehouse",
            longitude=3.0,
            latitude=4.0,
        )
    )
    db_session.commit()

    sync_resolved_lnglat_to_cache_tables(
        db_session, "门店甲", "store", 116.1, 31.2
    )
    sync_resolved_lnglat_to_cache_tables(
        db_session, "仓A", "warehouse", 120.0, 32.0
    )
    db_session.commit()

    s = (
        db_session.query(StoreCoordinate)
        .filter(StoreCoordinate.store_name == "门店甲")
        .one()
    )
    assert abs(s.longitude - 116.1) < 1e-6
    assert abs(s.latitude - 31.2) < 1e-6
    a1 = (
        db_session.query(AddressCache)
        .filter(AddressCache.address_name == "门店甲")
        .one()
    )
    assert abs(a1.longitude - 116.1) < 1e-6
    a2 = (
        db_session.query(AddressCache)
        .filter(AddressCache.address_name == "仓A")
        .one()
    )
    assert abs(a2.longitude - 120.0) < 1e-6
    assert abs(a2.latitude - 32.0) < 1e-6


def test_sync_skips_nonexistent_and_empty_label(db_session):
    sync_resolved_lnglat_to_cache_tables(db_session, "", "store", 1.0, 2.0)
    sync_resolved_lnglat_to_cache_tables(
        db_session, "不存在的名", "store", 1.0, 2.0
    )
    db_session.commit()
    assert db_session.query(StoreCoordinate).count() == 0
    assert db_session.query(AddressCache).count() == 0
