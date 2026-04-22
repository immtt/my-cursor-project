from datetime import date
from typing import Optional

import pytest

from app.models.entities import ManualRoute, SysSuggest
from app.services.diff_analysis_service import (
    list_multi_vehicle_stores,
    store_diff_summary,
    vehicle_diff_by_type,
)


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


def test_vehicle_diff_by_type_system_vs_manual(db_session):
    d = date(2026, 6, 1)
    db_session.add(_manual("M1", "店A,店B", d))
    db_session.add(_manual("M2", "店B", d))
    m3 = _manual("M3", "店C", d)
    m3.vehicle_type = "6.8米"
    db_session.add(m3)
    db_session.add(
        SysSuggest(
            route_date=d,
            waybill_no="S1",
            route_line="L",
            warehouse_name="W1",
            stores="店D",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, d, d, "all")
    vd = r["vehicle_diff"]
    assert vd["system_total"] == 1
    assert vd["manual_total"] == 3
    assert vd["total_vehicle_diff"] == -2
    by = {x["vehicle_type"]: x for x in vd["by_vehicle_type"]}
    assert by["4.2米"]["system_count"] == 1
    assert by["4.2米"]["manual_count"] == 2
    assert by["4.2米"]["diff"] == -1
    assert by["6.8米"]["system_count"] == 0
    assert by["6.8米"]["manual_count"] == 1
    assert by["6.8米"]["diff"] == -1
    vst = r["vehicle_store_trend_by_day"]
    assert len(vst) == 1
    assert vst[0]["route_date"] == d.isoformat()
    assert vst[0]["system_waybill_count"] == 1
    assert vst[0]["manual_waybill_count"] == 3
    assert vst[0]["system_store_count"] == 1
    assert vst[0]["manual_store_count"] == 3
    wsl = r["waybill_store_load"]
    assert wsl["summary"]["waybill_count"] == 4
    assert wsl["summary"]["avg_store_count"] == 1.25
    assert wsl["summary"]["system_avg_store_count"] == 1.0
    assert wsl["summary"]["manual_avg_store_count"] == 1.33
    by_wb = {x["waybill_no"]: x for x in wsl["items"]}
    assert by_wb["M1"]["store_count"] == 2
    assert by_wb["M3"]["store_count"] == 1
    sd = r["store_diff"]
    assert sd["system_store_count"] == 1
    assert sd["manual_store_count"] == 3
    assert sd["diff"] == -2
    assert sd["only_in_system"] == ["店D"]
    assert set(sd["only_in_manual"]) == {"店A", "店B", "店C"}


def test_store_diff_only_sides_and_symmetric_equal(db_session):
    """门店对称差：仅系统 / 仅手工 列表与两侧集合一致时为空。"""
    d = date(2026, 8, 1)
    db_session.add(
        SysSuggest(
            route_date=d,
            waybill_no="S1",
            route_line="L",
            warehouse_name="W1",
            stores="公店,仅系统",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.add(_manual("M1", "公店,仅手工", d))
    db_session.commit()
    sd = store_diff_summary(db_session, d, d, None)
    assert sd["only_in_system"] == ["仅系统"]
    assert sd["only_in_manual"] == ["仅手工"]
    sd_same = store_diff_summary(db_session, d, d, "W1")
    assert sd_same["only_in_system"] == ["仅系统"]
    assert sd_same["only_in_manual"] == ["仅手工"]


def test_store_diff_both_sides_identical_stores_empty_lists(db_session):
    d = date(2026, 8, 2)
    db_session.add(
        SysSuggest(
            route_date=d,
            waybill_no="S1",
            route_line="L",
            warehouse_name="W1",
            stores="同店",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.add(_manual("M1", "同店", d))
    db_session.commit()
    sd = store_diff_summary(db_session, d, d, None)
    assert sd["only_in_system"] == []
    assert sd["only_in_manual"] == []


def test_vehicle_diff_respects_warehouse_filter(db_session):
    d = date(2026, 6, 2)
    m = _manual("M1", "店", d)
    m.warehouse_name = "华东"
    db_session.add(m)
    m2 = _manual("M2", "店2", d)
    m2.waybill_no = "M2"
    m2.warehouse_name = "华北"
    db_session.add(m2)
    db_session.commit()
    vd = vehicle_diff_by_type(db_session, d, d, "华东")
    assert vd["manual_total"] == 1
    assert vd["system_total"] == 0
    assert vd["total_vehicle_diff"] == -1


def test_vehicle_diff_counts_waybills_same_store_multiple_trips(db_session):
    """同车型、多运单、同一拼载店 → 运单数按行计。"""
    d = date(2026, 7, 1)
    db_session.add(_manual("M1", "店X", d))
    db_session.add(_manual("M2", "店X", d))
    db_session.commit()
    vd = vehicle_diff_by_type(db_session, d, d, None)
    by = {x["vehicle_type"]: x for x in vd["by_vehicle_type"]}
    assert by["4.2米"]["manual_count"] == 2
    assert vd["manual_total"] == 2
    sd = store_diff_summary(db_session, d, d, None)
    assert sd["manual_store_count"] == 1


def test_vehicle_diff_waybills_across_vehicle_types(db_session):
    """同一店两车型两条运单：各车型 1 单，运单合计 2。"""
    d = date(2026, 7, 2)
    m1 = _manual("M1", "店Z", d)
    m1.vehicle_type = "4.2米"
    m2 = _manual("M2", "店Z", d)
    m2.vehicle_type = "6.8米"
    db_session.add(m1)
    db_session.add(m2)
    db_session.commit()
    vd = vehicle_diff_by_type(db_session, d, d, None)
    by = {x["vehicle_type"]: x for x in vd["by_vehicle_type"]}
    assert by["4.2米"]["manual_count"] == 1
    assert by["6.8米"]["manual_count"] == 1
    assert vd["manual_total"] == 2
    sd = store_diff_summary(db_session, d, d, None)
    assert sd["manual_store_count"] == 1


def test_multi_vehicle_three_waybills_one_store(db_session):
    db_session.add(_manual("WB001", "门店甲,门店乙"))
    db_session.add(_manual("WB002", "门店甲"))
    db_session.add(_manual("WB003", "门店甲"))
    db_session.commit()
    d = date(2026, 4, 22)
    r = list_multi_vehicle_stores(db_session, d, d, "manual")
    assert {x["store_name"] for x in r["items"]} == {"门店甲"}
    row = next(x for x in r["items"] if x["store_name"] == "门店甲")
    assert [w["waybill_no"] for w in row["waybills"]] == ["WB001", "WB002", "WB003"]
    assert [w["item_seq"] for w in row["waybills"]] == [1, 2, 3]
    assert {w.get("dataset_type") for w in row["waybills"]} == {"manual"}
    assert row.get("route_date") == d.isoformat()


def test_single_waybill_store_excluded(db_session):
    db_session.add(_manual("WB1", "仅一单店"))
    db_session.commit()
    d = date(2026, 4, 22)
    r = list_multi_vehicle_stores(db_session, d, d, "manual")
    assert r["items"] == []


def test_duplicate_store_in_one_waybill_counts_once(db_session):
    db_session.add(_manual("WB1", "门店甲,门店甲,门店甲"))
    db_session.add(_manual("WB2", "门店甲"))
    db_session.commit()
    d = date(2026, 4, 22)
    r = list_multi_vehicle_stores(db_session, d, d, "manual")
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
    d1 = date(2026, 5, 1)
    r = list_multi_vehicle_stores(db_session, d1, d1, "system")
    names = {x["store_name"] for x in r["items"]}
    assert "A店" in names
    a = next(x for x in r["items"] if x["store_name"] == "A店")
    assert {w["waybill_no"] for w in a["waybills"]} == {"S1", "S2"}
    assert {w.get("dataset_type") for w in a["waybills"]} == {"system"}


def test_all_unmerged_not_one_plus_one_on_different_sides(db_session):
    """全部：1 手工 + 1 系统同店，两侧各自都只有 1 车，不当成一店多车。"""
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
    r = list_multi_vehicle_stores(db_session, d, d, "all")
    assert r["items"] == []


def test_all_unmerged_two_manual_one_system_shows_only_manual_block(db_session):
    """全部：同店 2 手工 + 1 系统 → 只返回手工侧一店多车（2 个运单）。"""
    d = date(2026, 4, 22)
    db_session.add(_manual("MW1", "门店甲", d))
    db_session.add(_manual("MW2", "门店甲", d))
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
    r = list_multi_vehicle_stores(db_session, d, d, "all")
    assert len(r["items"]) == 1
    row = r["items"][0]
    assert [w["waybill_no"] for w in row["waybills"]] == ["MW1", "MW2"]
    assert {w["dataset_type"] for w in row["waybills"]} == {"manual"}


def test_all_unmerged_both_sides_multivehicle_two_items_same_store(db_session):
    d = date(2026, 4, 22)
    db_session.add(_manual("M1", "X店", d))
    db_session.add(_manual("M2", "X店", d))
    db_session.add(
        SysSuggest(
            route_date=d,
            waybill_no="S1",
            route_line="L",
            warehouse_name="W",
            stores="X店",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.add(
        SysSuggest(
            route_date=d,
            waybill_no="S2",
            route_line="L",
            warehouse_name="W",
            stores="X店",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=10.0,
            est_duration=20,
        )
    )
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, d, d, "all")
    assert len(r["items"]) == 2
    assert [x["store_name"] for x in r["items"]] == ["X店", "X店"]
    mrow = next(x for x in r["items"] if x["waybills"][0]["dataset_type"] == "manual")
    srow = next(x for x in r["items"] if x["waybills"][0]["dataset_type"] == "system")
    assert {w["waybill_no"] for w in mrow["waybills"]} == {"M1", "M2"}
    assert {w["waybill_no"] for w in srow["waybills"]} == {"S1", "S2"}


def test_date_range_two_days_both_included(db_session):
    d1, d2 = date(2026, 4, 22), date(2026, 4, 23)
    db_session.add(_manual("A1", "P店", d1))
    db_session.add(_manual("A2", "P店", d1))
    db_session.add(_manual("B1", "Q店", d2))
    db_session.add(_manual("B2", "Q店", d2))
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, d1, d2, "manual")
    assert len(r["items"]) == 2
    dates = {x["route_date"] for x in r["items"]}
    assert dates == {d1.isoformat(), d2.isoformat()}


def test_inverted_date_range_raises(db_session):
    d1, d2 = date(2026, 4, 23), date(2026, 4, 22)
    with pytest.raises(ValueError, match="route_date_from must be"):
        list_multi_vehicle_stores(db_session, d1, d2, "manual")


def test_response_includes_trend_and_warehouse_options(db_session):
    d1, d2 = date(2026, 4, 22), date(2026, 4, 23)
    db_session.add(_manual("A1", "P店", d1))
    db_session.add(_manual("A2", "P店", d1))
    db_session.add(_manual("B1", "Q店", d2))
    db_session.add(_manual("B2", "Q店", d2))
    db_session.commit()
    r = list_multi_vehicle_stores(db_session, d1, d2, "manual")
    assert "trend_by_day" in r
    assert "warehouse_options" in r
    assert len(r["trend_by_day"]) == 2
    assert r["trend_by_day"][0]["route_date"] == d1.isoformat()
    assert r["trend_by_day"][0]["system_multi_vehicle_store_count"] == 0
    assert r["trend_by_day"][0]["manual_multi_vehicle_store_count"] == 1
    assert r["trend_by_day"][1]["manual_multi_vehicle_store_count"] == 1
    assert "W1" in r["warehouse_options"]


def test_warehouse_name_filters_rows(db_session):
    d = date(2026, 4, 22)
    a1 = _manual("WA1", "店甲", d)
    a1.warehouse_name = "WH_A"
    a2 = _manual("WA2", "店甲", d)
    a2.warehouse_name = "WH_A"
    b1 = _manual("WB1", "店甲", d)
    b1.warehouse_name = "WH_B"
    db_session.add_all([a1, a2, b1])
    db_session.commit()
    r_b = list_multi_vehicle_stores(db_session, d, d, "manual", "WH_B")
    assert r_b["items"] == []
    r_a = list_multi_vehicle_stores(db_session, d, d, "manual", "WH_A")
    assert len(r_a["items"]) == 1
    t = r_a["trend_by_day"][0]
    assert t["manual_multi_vehicle_store_count"] == 1
    assert t["system_multi_vehicle_store_count"] == 0


def test_invalid_dataset_type_raises(db_session):
    with pytest.raises(ValueError, match=r"all \| system \| manual"):
        list_multi_vehicle_stores(
            db_session, date(2026, 4, 22), date(2026, 4, 22), "manual_calc_success"
        )
