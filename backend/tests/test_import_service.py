import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
    tmp.close()
    wb.save(tmp.name)
    return tmp.name


def test_system_import_without_optional_metrics_defaults_to_zero(db_session):
    path = _write_workbook(
        REQUIRED_HEADERS,
        [[date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result == {"total_rows": 1, "success_rows": 1, "failed_rows": 0, "errors": []}
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0.0
    assert row.est_duration == 0


def test_import_rejects_blank_required_text_cells(db_session):
    path = _write_workbook(
        REQUIRED_HEADERS,
        [[date(2026, 4, 20), None, "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["total_rows"] == 1
    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert result["errors"] == [{"row": 2, "reason": "文本字段存在空值"}]
    assert db_session.query(SysSuggest).count() == 0
