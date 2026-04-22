from datetime import date

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.compare_service import run_compare
from app.services.route_map_service import build_route_map_payload


def test_route_map_payload_paired(db_session):
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
    cr = db_session.query(CompareResult).one()

    payload = build_route_map_payload(db_session, cr.id)
    assert payload["match_status"] == "full"
    assert payload["sys_waybill_no"] == "SYS001"
    assert payload["manual_waybill_no"] == "MAN001"
    assert payload["system"]["available"] is True
    assert payload["manual"]["available"] is True
    assert len(payload["system"]["path"]) >= 4
    assert payload["system"]["markers"][0]["kind"] == "warehouse"


def test_route_map_manual_only_row(db_session):
    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 21),
            waybill_no="MAN900",
            route_line="线路B",
            warehouse_name="仓库2",
            stores="门店丙",
            volume=3.0,
            load_rate=65,
            est_distance=10.0,
            est_duration=20,
            calc_status=1,
        )
    )
    db_session.commit()
    run_compare(db_session, date(2026, 4, 21), 0.5)
    cr = db_session.query(CompareResult).filter(CompareResult.sys_id.is_(None)).one()

    payload = build_route_map_payload(db_session, cr.id)
    assert payload["system"]["available"] is False
    assert payload["manual"]["available"] is True
    assert payload["sys_waybill_no"] is None


def test_route_map_not_found(db_session):
    try:
        build_route_map_payload(db_session, 99999)
    except ValueError as e:
        assert str(e) == "NOT_FOUND"
    else:
        raise AssertionError("expected ValueError")
