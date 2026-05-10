from datetime import date

from openpyxl import Workbook

from app.models.entities import ManualRoute, SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(tmp_path, headers, rows):
    file_path = tmp_path / "import.xlsx"
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    wb.save(file_path)
    return str(file_path)


def test_import_system_missing_optional_metrics_defaults_to_zero(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        REQUIRED_HEADERS,
        [[date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 10, 88]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.load_rate == 88
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_blank_required_text_cell_is_rejected(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        REQUIRED_HEADERS,
        [[date(2026, 4, 20), None, "线路A", "仓库1", "门店甲,门店乙", 10, 88]],
    )

    result = import_excel(db_session, "manual", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert "运单号存在空值" in result["errors"][0]["reason"]
    assert db_session.query(ManualRoute).count() == 0
