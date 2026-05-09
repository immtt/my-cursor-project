from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _write_workbook(path, headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_system_import_defaults_missing_optional_estimates_to_zero(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 10.5, 75]],
    )

    result = import_excel(db_session, "system", str(file_path))

    row = db_session.query(SysSuggest).one()
    assert result["success_rows"] == 1
    assert row.est_distance == 0
    assert row.est_duration == 0
