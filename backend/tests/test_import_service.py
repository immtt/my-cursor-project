import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def test_system_import_without_optional_estimates_does_not_reuse_last_column(db_session):
    wb = Workbook()
    sheet = wb.active
    sheet.append(["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"])
    sheet.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 80])

    fd, file_path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        wb.save(file_path)

        result = import_excel(db_session, "system", file_path)

        row = db_session.query(SysSuggest).one()
        assert result["success_rows"] == 1
        assert row.route_date == date(2026, 4, 20)
        assert row.load_rate == 80
        assert row.est_distance == 0
        assert row.est_duration == 0
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)
