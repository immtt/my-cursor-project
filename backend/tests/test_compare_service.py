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


def test_run_compare_includes_manual_only_rows(db_session):
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 21),
            waybill_no="MAN_ONLY",
            route_line="线路B",
            warehouse_name="仓库2",
            stores="门店丙",
            volume=8.0,
            load_rate=60,
            est_distance=20,
            est_duration=40,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 21), 0.5)

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 1
    assert rows[0].sys_id is None
    assert rows[0].manual_id is not None
    assert rows[0].match_status == "none"


def test_run_compare_does_not_bind_zero_overlap_rows(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 22),
            waybill_no="SYS_NO_OVERLAP",
            route_line="线路C",
            warehouse_name="仓库3",
            stores="门店甲",
            volume=9.0,
            load_rate=70,
            est_distance=40,
            est_duration=80,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 22),
            waybill_no="MAN_NO_OVERLAP",
            route_line="线路D",
            warehouse_name="仓库4",
            stores="门店乙",
            volume=10.0,
            load_rate=68,
            est_distance=42,
            est_duration=85,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 22), 0.5)

    rows = db_session.query(CompareResult).all()
    assert len(rows) == 2
    assert all(row.match_status == "none" for row in rows)
    assert not any(row.sys_id is not None and row.manual_id is not None for row in rows)
