from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def test_system_import_missing_optional_estimate_columns_defaults_to_zero(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.append(["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"])
    ws.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 85.5])
    wb.save(file_path)

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0
