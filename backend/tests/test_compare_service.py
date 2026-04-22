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
