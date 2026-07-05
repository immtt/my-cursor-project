from datetime import date

from app.models.entities import ManualRoute, SysSuggest
from app.services.compare_service import run_compare


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

    from app.models.entities import CompareResult

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].match_status == "full"


def test_run_compare_omits_estimate_diffs_when_system_estimates_are_missing(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 21),
            waybill_no="SYS002",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲,门店乙",
            volume=9.0,
            load_rate=70,
            est_distance=None,
            est_duration=None,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 21),
            waybill_no="MAN002",
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

    run_compare(db_session, date(2026, 4, 21), 0.5)

    from app.models.entities import CompareResult

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].est_distance_diff is None
    assert rows[0].est_duration_diff is None
