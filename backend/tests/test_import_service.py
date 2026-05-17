from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import REQUIRED_COLUMNS, import_excel


def test_system_import_defaults_missing_optional_metrics_without_reading_wrong_column(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(REQUIRED_COLUMNS)
    sheet.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70])
    workbook.save(file_path)

    result = import_excel(db_session, "system", str(file_path))

    row = db_session.query(SysSuggest).one()
    assert result["success_rows"] == 1
    assert row.route_date == date(2026, 4, 20)
    assert row.est_distance == 0
    assert row.est_duration == 0
