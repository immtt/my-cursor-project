import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import CompareResult, SysSuggest
from app.services.import_service import import_excel


def _write_workbook(headers, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    workbook.save(path)
    return path


def test_system_import_keeps_missing_optional_estimates_null(db_session):
    path = _write_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 10, "70%"]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance is None
    assert row.est_duration is None


def test_system_import_replaces_existing_waybill_and_clears_stale_compare_results(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
            route_line="旧线路",
            warehouse_name="仓库1",
            stores="门店甲",
            volume=5,
            load_rate=50,
            est_distance=10,
            est_duration=20,
        )
    )
    db_session.add(
        CompareResult(
            route_date=date(2026, 4, 20),
            sys_id=1,
            manual_id=None,
            match_status="none",
            store_match_rate=0,
        )
    )
    db_session.commit()

    path = _write_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率", "预计公里数", "预计时效"],
        [["2026-04-20", "SYS001", "新线路", "仓库1", "门店甲,门店乙", 10, "70%", 35, 60]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].route_line == "新线路"
    assert rows[0].est_distance == 35
    assert rows[0].est_duration == 60
    assert db_session.query(CompareResult).count() == 0


def test_system_import_rejects_blank_required_text(db_session):
    path = _write_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", None, "线路A", "仓库1", "门店甲,门店乙", 10, "70%"]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert db_session.query(SysSuggest).count() == 0
