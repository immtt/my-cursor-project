import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import ManualRoute, SysSuggest
from app.services.compare_service import overview, run_compare
from app.services.import_service import import_excel


def _save_workbook(headers, row):
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    ws.append(row)
    wb.save(path)
    return path


def test_import_system_without_optional_estimates_keeps_them_unknown(db_session):
    path = _save_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    sys_row = db_session.query(SysSuggest).one()
    assert sys_row.est_distance is None
    assert sys_row.est_duration is None


def test_compare_skips_estimate_diffs_when_system_estimates_are_unknown(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
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

    summary = overview(db_session, date(2026, 4, 20))
    assert summary["avg_distance_diff"] is None
    assert summary["avg_duration_diff"] is None
