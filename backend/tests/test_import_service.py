from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _save_workbook(tmp_path, headers, row):
    file_path = tmp_path / "import.xlsx"
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    sheet.append(row)
    wb.save(file_path)
    return file_path


def test_system_import_missing_optional_metrics_does_not_read_last_column(db_session, tmp_path):
    file_path = _save_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率", "备注"],
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%", 999],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_system_import_reads_optional_metrics_by_header_name(db_session, tmp_path):
    file_path = _save_workbook(
        tmp_path,
        ["排线日期", "预计时效", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率", "预计公里数"],
        ["2026-04-20", 80, "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%", 40.5],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 40.5
    assert row.est_duration == 80
