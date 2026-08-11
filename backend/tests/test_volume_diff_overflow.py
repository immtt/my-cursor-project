import math
from datetime import date

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.compare_service import overview, run_compare
from app.services.result_service import fetch_results


def test_near_zero_manual_volume_does_not_poison_json(db_session):
    """Finite but tiny volumes can overflow volume_diff_rate to Inf and crash JSON."""
    db_session.add(
        SysSuggest(
            route_date=date(2026, 8, 11),
            waybill_no="S1",
            route_line="L1",
            warehouse_name="WH",
            stores="A店,B店",
            volume=10.0,
            load_rate=50,
            est_distance=40,
            est_duration=60,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 8, 11),
            waybill_no="W1",
            route_line="L1",
            warehouse_name="WH",
            stores="A店,B店",
            volume=1e-323,
            load_rate=50,
            est_distance=42,
            est_duration=65,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 8, 11), 0.5)

    row = db_session.query(CompareResult).one()
    assert row.match_status == "full"
    assert row.volume_diff_rate is None

    results = fetch_results(db_session, date(2026, 8, 11))
    assert results[0]["volume_diff_rate"] is None

    summary = overview(db_session, date(2026, 8, 11))
    assert math.isfinite(summary["avg_volume_diff"])
    assert summary["avg_volume_diff"] == 0


def test_normal_volume_diff_rate_still_computed(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 8, 11),
            waybill_no="S1",
            route_line="L1",
            warehouse_name="WH",
            stores="A店",
            volume=9.0,
            load_rate=50,
            est_distance=40,
            est_duration=60,
        )
    )
    db_session.add(
        ManualRoute(
            route_date=date(2026, 8, 11),
            waybill_no="W1",
            route_line="L1",
            warehouse_name="WH",
            stores="A店",
            volume=10.0,
            load_rate=50,
            est_distance=42,
            est_duration=65,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 8, 11), 0.5)
    row = db_session.query(CompareResult).one()
    assert row.volume_diff_rate == -10.0
