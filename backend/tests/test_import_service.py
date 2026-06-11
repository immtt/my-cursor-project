from datetime import date

from openpyxl import Workbook

from app.models.entities import ManualRoute, SysSuggest
from app.services.import_service import import_excel


def _write_workbook(tmp_path, headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    path = tmp_path / "import.xlsx"
    wb.save(path)
    return str(path)


def test_system_import_missing_optional_estimate_columns_defaults_to_zero(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_rejects_blank_required_text_cells(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", None, "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "manual", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert result["errors"][0]["reason"] == "文本字段存在空值"
    assert db_session.query(ManualRoute).count() == 0
