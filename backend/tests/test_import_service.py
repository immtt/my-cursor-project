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


def _import_workbook(db_session, dataset_type, headers, rows):
    path = _write_workbook(headers, rows)
    try:
        return import_excel(db_session, dataset_type, path)
    finally:
        os.remove(path)


def test_system_import_keeps_missing_optional_estimates_null(db_session):
    headers = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]
    result = _import_workbook(
        db_session,
        "system",
        headers,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9.0, 88.5]],
    )

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.load_rate == 88.5
    assert row.est_distance is None
    assert row.est_duration is None


def test_system_import_handles_one_optional_estimate_column(db_session):
    headers = [
        "排线日期",
        "运单号",
        "归属线路",
        "始发仓库",
        "拼载门店",
        "配送体积",
        "装载率",
        "预计公里数",
    ]
    result = _import_workbook(
        db_session,
        "system",
        headers,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9.0, 88.5, 42.3]],
    )

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 42.3
    assert row.est_duration is None


def test_reimport_replaces_existing_row_and_clears_stale_compare_results(db_session):
    headers = [
        "排线日期",
        "运单号",
        "归属线路",
        "始发仓库",
        "拼载门店",
        "配送体积",
        "装载率",
        "预计公里数",
        "预计时效",
    ]
    _import_workbook(
        db_session,
        "system",
        headers,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9.0, 70, 40, 80]],
    )
    existing = db_session.query(SysSuggest).one()
    db_session.add(
        CompareResult(
            route_date=date(2026, 4, 20),
            sys_id=existing.id,
            manual_id=None,
            match_status="none",
            store_match_rate=0.0,
        )
    )
    db_session.commit()

    _import_workbook(
        db_session,
        "system",
        headers,
        [["2026-04-20", "SYS001", "线路B", "仓库2", "门店乙", 11.0, 75, 50, 90]],
    )

    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].route_line == "线路B"
    assert rows[0].warehouse_name == "仓库2"
    assert db_session.query(CompareResult).count() == 0
