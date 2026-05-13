import os
import tempfile

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _write_workbook(headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        path = tmp.name
    wb.save(path)
    return path


def test_import_system_defaults_missing_optional_metrics_to_zero(db_session):
    path = _write_workbook(
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 12.5, "75%"]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_system_uses_present_optional_metrics(db_session):
    path = _write_workbook(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 12.5, "75%", 42.8, 90]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 42.8
    assert row.est_duration == 90
