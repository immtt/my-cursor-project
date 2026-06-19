import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _write_workbook(headers, row):
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    sheet.append(row)
    wb.save(path)
    return path


def test_import_system_without_optional_metrics_defaults_to_zero(db_session):
    path = _write_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 85],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_rejects_empty_required_text_cells(db_session):
    path = _write_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS001", None, "仓库1", "门店甲,门店乙", 9.0, 85],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert result["errors"][0]["row"] == 2
    assert "文本字段存在空值" in result["errors"][0]["reason"]
    assert db_session.query(SysSuggest).count() == 0
