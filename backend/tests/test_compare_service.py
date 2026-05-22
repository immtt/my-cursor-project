from datetime import date

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.compare_service import run_compare
from app.services.result_service import fetch_results


def test_run_compare_generates_match(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
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
            waybill_no="MAN001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店乙,门店甲",
            volume=10.0,
            load_rate=68,
            est_distance=42,
            est_duration=85,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 20), 0.5)

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].match_status == "full"


def test_run_compare_does_not_link_unmatched_manual_route(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲",
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
            route_line="线路B",
            warehouse_name="仓库2",
            stores="门店乙",
            volume=10.0,
            load_rate=68,
            est_distance=42,
            est_duration=85,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 20), 0.5)

    row = db_session.query(CompareResult).one()
    assert row.match_status == "none"
    assert row.manual_id is None
    assert row.volume_diff_rate is None
    assert row.est_distance_diff is None
    assert row.est_duration_diff is None
    assert fetch_results(db_session, date(2026, 4, 20))[0]["manual_waybill_no"] is None
