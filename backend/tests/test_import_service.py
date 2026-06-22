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


def test_system_import_without_optional_estimates_defaults_to_zero(db_session, tmp_path):
    file_path = tmp_path / "system_required_only.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 85],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.load_rate == 85
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_rejects_empty_required_text_cells(db_session, tmp_path):
    file_path = tmp_path / "system_empty_route_line.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-20", "SYS001", None, "仓库1", "门店甲,门店乙", 9.0, 85],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert result["errors"][0]["row"] == 2
    assert "文本字段存在空值" in result["errors"][0]["reason"]
    assert db_session.query(SysSuggest).count() == 0
