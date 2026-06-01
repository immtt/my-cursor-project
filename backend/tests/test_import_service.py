from openpyxl import Workbook

from app.models.entities import ManualRoute, SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(path, headers, row):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    sheet.append(row)
    wb.save(path)


def test_system_import_defaults_missing_optional_estimates(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        REQUIRED_HEADERS,
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 77],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0.0
    assert row.est_duration == 0


def test_import_rejects_blank_required_text_cells(db_session, tmp_path):
    file_path = tmp_path / "manual.xlsx"
    _write_workbook(
        file_path,
        REQUIRED_HEADERS,
        ["2026-04-20", "MAN001", "线路A", "仓库1", None, 9.0, 77],
    )

    result = import_excel(db_session, "manual", str(file_path))

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert "拼载门店不能为空" in result["errors"][0]["reason"]
    assert db_session.query(ManualRoute).count() == 0
