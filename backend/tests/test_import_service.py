from app.models.entities import SysSuggest
from app.services.import_service import import_excel

from openpyxl import Workbook


REQUIRED_HEADERS = [
    "排线日期",
    "运单号",
    "归属线路",
    "始发仓库",
    "拼载门店",
    "配送体积",
    "装载率",
]


def _save_workbook(tmp_path, headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    file_path = tmp_path / "routes.xlsx"
    wb.save(file_path)
    return str(file_path)


def test_system_import_without_optional_columns_defaults_metrics_to_zero(db_session, tmp_path):
    file_path = _save_workbook(
        tmp_path,
        REQUIRED_HEADERS,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    assert result["failed_rows"] == 0
    row = db_session.query(SysSuggest).one()
    assert row.load_rate == 70
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_rejects_blank_required_text_cells(db_session, tmp_path):
    file_path = _save_workbook(
        tmp_path,
        REQUIRED_HEADERS,
        [["2026-04-20", None, "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert db_session.query(SysSuggest).count() == 0
