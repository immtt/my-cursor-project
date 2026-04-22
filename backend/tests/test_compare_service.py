from datetime import date

from app.models.entities import ManualRoute, SysSuggest
from app.services.compare_service import overview, refresh_compare_after_import, run_compare
from app.services.result_service import fetch_results


def test_refresh_compare_after_import_runs_touched_day(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲",
            vehicle_type="4.2米",
            volume=9.0,
            load_rate=70,
            est_distance=40,
            est_duration=80,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 20),
            waybill_no="MAN001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲",
            vehicle_type="4.2米",
            volume=10.0,
            load_rate=68,
            calc_status=0,
        )
    )
    db_session.commit()
    out = refresh_compare_after_import(db_session, [date(2026, 4, 20)], 0.5)
    assert out["compare_dates_run"] == ["2026-04-20"]
    assert out["compare_result_rows"] >= 1


def test_run_compare_generates_match(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲,门店乙",
            vehicle_type="4.2米",
            volume=9.0,
            load_rate=70,
            est_distance=40,
            est_duration=80,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 20),
            waybill_no="MAN001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店乙,门店甲",
            vehicle_type="4.2米",
            volume=10.0,
            load_rate=68,
            est_distance=42,
            est_duration=85,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 20), 0.5)

    from app.models.entities import CompareResult

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].match_status == "full"


def test_run_compare_tie_break_by_abs_volume_diff(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS100",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲,门店乙",
            volume=9.0,
            load_rate=70,
            est_distance=40,
            est_duration=80,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 20),
            waybill_no="MAN900",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲,门店乙",
            volume=12.0,
            load_rate=68,
            est_distance=42,
            est_duration=85,
            calc_status=1,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 20),
            waybill_no="MAN100",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲,门店乙",
            volume=10.0,
            load_rate=68,
            est_distance=41,
            est_duration=83,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 20), 0.5)

    from app.models.entities import CompareResult

    paired = db_session.query(CompareResult).filter(CompareResult.sys_id.isnot(None)).one()
    assert paired.manual_id is not None
    chosen = db_session.query(ManualRoute).filter(ManualRoute.id == paired.manual_id).first()
    assert chosen.waybill_no == "MAN100"

    orphan = db_session.query(CompareResult).filter(CompareResult.sys_id.is_(None)).one()
    orphan_man = db_session.query(ManualRoute).filter(ManualRoute.id == orphan.manual_id).first()
    assert orphan_man.waybill_no == "MAN900"


def test_run_compare_partial_when_overlap_but_not_full(db_session):
    """PRD：匹配度 33.33%（1 家重合 / max(1,3)）应为部分匹配，非未匹配。"""
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 21),
            waybill_no="TS20260421000060",
            route_line="裕安金安线",
            warehouse_name="合肥肥西丰树生态园",
            stores="六安金安区东方名城店",
            volume=10.0,
            load_rate=70,
            est_distance=40,
            est_duration=80,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 21),
            waybill_no="FC66666309910042443",
            route_line="裕安金安线",
            warehouse_name="合肥肥西丰树生态园",
            stores="六安金安区东方名城店,六安裕安区红达星河城店,六安金安区寿春小区店",
            volume=10.0,
            load_rate=70,
            est_distance=40,
            est_duration=80,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 21), 0.5)

    from app.models.entities import CompareResult

    row = db_session.query(CompareResult).one()
    assert row.match_status == "partial"
    assert row.store_match_rate == 33.33


def test_overview_and_results_filter_by_warehouse(db_session):
    rd = date(2026, 4, 22)
    db_session.add(
        SysSuggest(
            route_date=rd,
            waybill_no="S_A",
            route_line="线路A",
            warehouse_name="华东仓",
            stores="门店甲,门店乙",
            volume=1.0,
            load_rate=70,
            est_distance=10,
            est_duration=20,
        )
    )
    db_session.add(
        SysSuggest(
            route_date=rd,
            waybill_no="S_B",
            route_line="线路B",
            warehouse_name="华北仓",
            stores="门店丙",
            volume=2.0,
            load_rate=70,
            est_distance=12,
            est_duration=25,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=rd,
            waybill_no="M_A",
            route_line="线路A",
            warehouse_name="华东仓",
            stores="门店乙,门店甲",
            volume=1.0,
            load_rate=70,
            est_distance=10,
            est_duration=20,
            calc_status=1,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=rd,
            waybill_no="M_B",
            route_line="线路B",
            warehouse_name="华北仓",
            stores="门店丙",
            volume=2.0,
            load_rate=70,
            est_distance=12,
            est_duration=25,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, rd, 0.5)

    o_all = overview(db_session, rd, rd)
    assert o_all["total"] == 2
    assert o_all["total_trip_diff"] == 0
    assert "total_volume_diff" in o_all
    assert "total_distance_diff" in o_all
    assert "total_duration_diff" in o_all
    assert set(o_all["warehouse_options"]) == {"华东仓", "华北仓"}

    o_east = overview(db_session, rd, rd, warehouse_name="华东仓")
    assert o_east["total"] == 1
    assert o_east["total_trip_diff"] == 0

    rows_east = fetch_results(db_session, rd, rd, None, "华东仓")
    assert len(rows_east) == 1
    assert rows_east[0]["sys_waybill_no"] == "S_A"

    rows_wrong = fetch_results(db_session, rd, rd, None, "不存在仓")
    assert rows_wrong == []
