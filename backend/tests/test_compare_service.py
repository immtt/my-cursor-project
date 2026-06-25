from datetime import date

from app.models.entities import CompareResult, ManualRoute, SysSuggest
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

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].match_status == "full"


def test_run_compare_preserves_existing_results_without_system_rows(db_session):
    db_session.add(
        CompareResult(
            route_date=date(2026, 4, 20),
            sys_id=None,
            manual_id=None,
            match_status="none",
            store_match_rate=0,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 20), 0.5)

    rows = db_session.query(CompareResult).filter(CompareResult.route_date == date(2026, 4, 20)).all()
    assert len(rows) == 1
    assert rows[0].match_status == "none"
