from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _write_workbook(path, headers, row):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    sheet.append(row)
    wb.save(path)


def test_system_import_defaults_missing_optional_route_metrics(db_session, tmp_path):
    file_path = tmp_path / "system_import.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    assert result["failed_rows"] == 0
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_system_import_missing_optional_metrics_allows_percent_load_rate(db_session, tmp_path):
    file_path = tmp_path / "system_import_percent.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS002", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%"],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    assert result["failed_rows"] == 0
    row = db_session.query(SysSuggest).one()
    assert row.load_rate == 70
    assert row.est_distance == 0
    assert row.est_duration == 0
