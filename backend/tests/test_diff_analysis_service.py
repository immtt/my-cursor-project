from datetime import date
from typing import Optional

import pytest

from app.models.entities import ManualRoute, SysSuggest
from app.services.diff_analysis_service import list_multi_vehicle_stores


def _manual(waybill_no: str, stores: str, route_date: Optional[date] = None):
    d = route_date or date(2026, 4, 22)
    return ManualRoute(
        route_date=d,
        waybill_no=waybill_no,
        route_line="L1",
        warehouse_name="W1",
        stores=stores,
        vehicle_type="4.2米",
        volume=1.0,
        load_rate=50.0,
        est_distance=10.0,
        est_duration=30,
        calc_status=0,
    )


def test_multi_vehicle_three_waybills_one_store(db_session):
    db_session.add(_manual("WB001", "门店甲,门店乙"))
    db_session.add(_manual("WB002", "门店甲"))
    db_session.add(_manual("WB003", "门店甲"))
    db_session.commit()

    r = list_multi_vehicle_stores(db_session, date(2026, 4, 22), "manual")
    assert {x["store_name"] for x in r["items"]} == {"门店甲"}
    row = next(x for x in r["items"] if x["store_name"] == "门店甲")
    assert [w["waybill_no"] for w in row["waybills"]] == ["WB001", "WB002", "WB003"]
    assert [w["item_seq"] for w in row["waybills"]] == [1, 2, 3]
    assert {w.get("dataset_type") for w in row["waybills"]} == {"manual"}


def test_single_waybill_store_excluded(db_session):
    db_session.add(_manual("WB1", "仅一单店"))
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, date(2026, 4, 22), "manual")
    assert r["items"] == []


def test_duplicate_store_in_one_waybill_counts_once(db_session):
    db_session.add(_manual("WB1", "门店甲,门店甲,门店甲"))
    db_session.add(_manual("WB2", "门店甲"))
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, date(2026, 4, 22), "manual")
    assert len(r["items"]) == 1
    assert [w["waybill_no"] for w in r["items"][0]["waybills"]] == ["WB1", "WB2"]


def test_system_dataset(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 5, 1),
            waybill_no="S1",
            route_line="L",
            warehouse_name="W",
            stores="A店",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.add(
        SysSuggest(
            route_date=date(2026, 5, 1),
            waybill_no="S2",
            route_line="L",
            warehouse_name="W",
            stores="A店,B店",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, date(2026, 5, 1), "system")
    names = {x["store_name"] for x in r["items"]}
    assert "A店" in names
    a = next(x for x in r["items"] if x["store_name"] == "A店")
    assert {w["waybill_no"] for w in a["waybills"]} == {"S1", "S2"}
    assert {w.get("dataset_type") for w in a["waybills"]} == {"system"}


def test_all_dataset_merges_system_and_manual(db_session):
    d = date(2026, 4, 22)
    db_session.add(_manual("MW1", "门店甲", d))
    db_session.add(
        SysSuggest(
            route_date=d,
            waybill_no="SW1",
            route_line="L",
            warehouse_name="W",
            stores="门店甲",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, d, "all")
    assert len(r["items"]) == 1
    wbs = {w["waybill_no"]: w["dataset_type"] for w in r["items"][0]["waybills"]}
    assert wbs == {"MW1": "manual", "SW1": "system"}


def test_invalid_dataset_type_raises(db_session):
    with pytest.raises(ValueError, match=r"all \| system \| manual"):
        list_multi_vehicle_stores(db_session, date(2026, 4, 22), "manual_calc_success")
