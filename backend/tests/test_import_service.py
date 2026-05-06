from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


SYSTEM_REQUIRED_HEADERS = [
    "排线日期",
    "运单号",
    "归属线路",
    "始发仓库",
    "拼载门店",
    "配送体积",
    "装载率",
]


def _write_workbook(tmp_path, headers, row):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    sheet.append(row)
    file_path = tmp_path / "routes.xlsx"
    workbook.save(file_path)
    return file_path


def test_import_system_defaults_missing_optional_estimates(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        SYSTEM_REQUIRED_HEADERS,
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 75],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_system_uses_optional_estimates_when_present(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        [*SYSTEM_REQUIRED_HEADERS, "预计公里数", "预计时效"],
        ["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 75, 42.5, 90],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 42.5
    assert row.est_duration == 90
