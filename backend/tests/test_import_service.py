from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(path, headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    wb.save(path)


def test_system_import_missing_optional_columns_defaults_to_zero(db_session, tmp_path):
    file_path = tmp_path / "system_without_optional.xlsx"
    _write_workbook(
        file_path,
        [*REQUIRED_HEADERS, "备注"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 10.0, 80, 999]],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0.0
    assert row.est_duration == 0


def test_import_replaces_existing_waybill_for_same_date(db_session, tmp_path):
    first_file = tmp_path / "system_first.xlsx"
    second_file = tmp_path / "system_second.xlsx"
    headers = [*REQUIRED_HEADERS, "预计公里数", "预计时效"]
    _write_workbook(
        first_file,
        headers,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 10.0, 80, 40.0, 80]],
    )
    _write_workbook(
        second_file,
        headers,
        [["2026-04-20", "SYS001", "线路B", "仓库1", "门店乙", 12.0, 85, 50.0, 90]],
    )

    import_excel(db_session, "system", str(first_file))
    import_excel(db_session, "system", str(second_file))

    rows = db_session.query(SysSuggest).filter(SysSuggest.route_date == date(2026, 4, 20)).all()
    assert len(rows) == 1
    assert rows[0].route_line == "线路B"
    assert rows[0].stores == "门店乙"
    assert rows[0].volume == 12.0
