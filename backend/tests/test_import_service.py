from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def test_system_import_defaults_missing_optional_estimates(tmp_path, db_session):
    file_path = tmp_path / "system_import.xlsx"
    wb = Workbook()
    sheet = wb.active
    sheet.append(["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"])
    sheet.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.5, 70])
    wb.save(file_path)

    result = import_excel(db_session, "system", str(file_path))

    assert result == {"total_rows": 1, "success_rows": 1, "failed_rows": 0, "errors": []}
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0
