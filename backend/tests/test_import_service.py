from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def test_system_import_without_optional_metrics_does_not_read_load_rate(tmp_path, db_session):
    file_path = tmp_path / "system.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"])
    sheet.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 75])
    workbook.save(file_path)

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    assert result["failed_rows"] == 0
    row = db_session.query(SysSuggest).one()
    assert row.load_rate == 75
    assert row.est_distance == 0
    assert row.est_duration == 0
