from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import REQUIRED_COLUMNS, import_excel


def test_system_import_missing_optional_metrics_default_to_zero(db_session, tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(REQUIRED_COLUMNS)
    sheet.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 10.5, 85])
    file_path = tmp_path / "system.xlsx"
    workbook.save(file_path)

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0
    assert row.est_duration == 0

