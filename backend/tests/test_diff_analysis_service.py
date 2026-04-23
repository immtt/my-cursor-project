from datetime import date
from typing import Optional

import pytest

from app.models.entities import ManualRoute, StorePairDistance, SysSuggest
from app.services.diff_analysis_service import (
    list_multi_vehicle_stores,
    store_diff_summary,
    vehicle_diff_by_type,
    waybill_store_load,
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
    bvt = {((x.get("dataset_type"), x["vehicle_type"])): x for x in wsl["by_vehicle_type"]}
    assert bvt[("system", "4.2米")]["waybill_count"] == 1
    assert bvt[("system", "4.2米")]["store_count_distribution"] == {"1": 1}
    assert bvt[("system", "4.2米")]["avg_store_count"] == 1.0
    assert bvt[("manual", "4.2米")]["waybill_count"] == 2
    assert bvt[("manual", "4.2米")]["store_count_distribution"] == {"1": 1, "2": 1}
    assert bvt[("manual", "4.2米")]["avg_store_count"] == 1.5
    assert bvt[("manual", "6.8米")]["store_count_distribution"] == {"1": 1}
    sd = r["store_diff"]
    assert sd["system_store_count"] == 1
    assert sd["manual_store_count"] == 3
    assert sd["diff"] == -2
    assert sd["only_in_system"] == ["店D"]
    assert set(sd["only_in_manual"]) == {"店A", "店B", "店C"}


def test_waybill_store_load_by_vehicle_type_distribution_and_avg(db_session):
    """按车型：各配载店数档位的运单数 + 单均（与截图口径一致）。"""
    d = date(2026, 4, 19)
    for i in range(2):
        m = _manual(f"WA{i}", "店A", d)
        m.vehicle_type = "4.2米标箱"
        db_session.add(m)
    for i in range(3):
        m = _manual(f"WB{i}", "店A,店B", d)
        m.vehicle_type = "4.2米标箱"
        db_session.add(m)
    for i in range(5):
        m = _manual(f"WC{i}", "店A,店B,店C", d)
        m.vehicle_type = "4.2米标箱"
        db_session.add(m)
    db_session.commit()
    w = waybill_store_load(db_session, d, d, "manual", None)
    bvt = {x["vehicle_type"]: x for x in w["by_vehicle_type"]}
    t = bvt["4.2米标箱"]
    assert t["waybill_count"] == 10
    assert t["store_count_distribution"] == {"1": 2, "2": 3, "3": 5}
    assert t["avg_store_count"] == 2.3
    assert "dataset_type" not in t


def test_waybill_distance_layers_and_manual_unset(db_session):
    """运单距离分层：km 分档 + 手工 est_distance 为空时计入 manual_unset。"""
    d = date(2026, 10, 15)

    def _sys(wb: str, km: float) -> SysSuggest:
        return SysSuggest(
            route_date=d,
            waybill_no=wb,
            route_line="L",
            warehouse_name="W1",
            stores="X",
            vehicle_type="4.2米",
            volume=1.0,
            load_rate=50.0,
            est_distance=km,
            est_duration=20,
        )

    m1 = _manual("M1", "a", d)
    m1.est_distance = 10.0
    m2 = _manual("M2", "b", d)
    m2.est_distance = None
    m3 = _manual("M3", "c", d)
    m3.est_distance = 75.0
    m4 = _manual("M4", "d", d)
    m4.est_distance = 200.0
    db_session.add(_sys("S1", 20.0))
    db_session.add(_sys("S2", 55.0))
    db_session.add(_sys("S3", 100.0))
    db_session.add(_sys("S4", 99.5))
    db_session.add_all([m1, m2, m3, m4])
    db_session.commit()
    lay = {x["layer_key"]: x for x in list_multi_vehicle_stores(db_session, d, d, "all")["waybill_distance_layers"]}
    assert lay["0_50"]["system_count"] == 1
    assert lay["0_50"]["manual_count"] == 1
    assert lay["0_50"]["diff"] == 0
    assert lay["50_70"]["system_count"] == 1
    assert lay["50_70"]["manual_count"] == 0
    assert lay["70_80"]["system_count"] == 0
    assert lay["70_80"]["manual_count"] == 1
    assert lay["80_100"]["system_count"] == 1
    assert lay["80_100"]["manual_count"] == 0
    assert lay["100_inf"]["system_count"] == 1
    assert lay["100_inf"]["manual_count"] == 1
    assert lay["manual_unset"]["system_count"] == 0
    assert lay["manual_unset"]["manual_count"] == 1
    assert lay["manual_unset"]["diff"] == -1
    for lk, row in lay.items():
        assert row.get("manual_with_inter_store_over_35km", -1) == 0
        assert row.get("ratio_manual_with_inter_store_over_35km_in_manual", -1.0) == 0.0


def test_waybill_distance_layers_inter_store_over_35km(db_session):
    """手工多店：店间表一段 >35 km 时计入该 est_distance 档的 long 计数。"""
    d = date(2026, 11, 1)
    db_session.add(StorePairDistance(store_from="近A", store_to="近B", distance_km=30.0))
    db_session.add(StorePairDistance(store_from="远A", store_to="远B", distance_km=40.0))
    m_short = _manual("MS", "近A,近B", d)
    m_short.est_distance = 25.0
    m_long = _manual("ML", "远A,远B", d)
    m_long.est_distance = 30.0
    m_unset = _manual("MU", "远A,远B", d)
    m_unset.est_distance = None
    m_one = _manual("M1", "单店", d)
    m_one.est_distance = 10.0
    db_session.add_all([m_short, m_long, m_unset, m_one])
    db_session.commit()
    lay = {
        x["layer_key"]: x
        for x in list_multi_vehicle_stores(db_session, d, d, "all")["waybill_distance_layers"]
    }
    z = lay["0_50"]
    assert z["manual_count"] == 3
    assert z["manual_with_inter_store_over_35km"] == 1
    assert abs(z["ratio_manual_with_inter_store_over_35km_in_manual"] - 1.0 / 3.0) < 1e-9
    u = lay["manual_unset"]
    assert u["manual_count"] == 1
    assert u["manual_with_inter_store_over_35km"] == 1
    assert u["ratio_manual_with_inter_store_over_35km_in_manual"] == 1.0


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
