from datetime import date

from openpyxl import Workbook

from app.models.entities import ManualRoute, SysSuggest
from app.services.import_service import import_excel


def _write_workbook(tmp_path, headers, row):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    sheet.append(row)
    file_path = tmp_path / "import.xlsx"
    workbook.save(file_path)
    return str(file_path)


def test_import_system_without_optional_columns_defaults_estimates(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-23", "SYS001", "线路A", "仓库1", "门店甲", 12.5, 85],
    )

    result = import_excel(db_session, "system", file_path)

    row = db_session.query(SysSuggest).one()
    assert result["success_rows"] == 1
    assert row.route_date == date(2026, 4, 23)
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_rejects_store_lists_without_valid_stores(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        ["2026-04-24", "MAN001", "线路A", "仓库1", " , , ", 10, 70],
    )

    result = import_excel(db_session, "manual", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert "有效门店" in result["errors"][0]["reason"]
    assert db_session.query(ManualRoute).count() == 0
