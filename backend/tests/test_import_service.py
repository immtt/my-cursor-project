from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _write_workbook(path, headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    wb.save(path)


def test_system_import_allows_missing_optional_distance_and_duration(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%"]],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    assert result["failed_rows"] == 0
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_system_import_uses_optional_distance_and_duration_when_present(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率", "预计公里数", "预计时效"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%", 42.5, 88]],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 42.5
    assert row.est_duration == 88
