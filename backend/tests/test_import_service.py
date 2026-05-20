import os
from datetime import date
from tempfile import NamedTemporaryFile

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(rows, headers=REQUIRED_HEADERS):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    tmp = NamedTemporaryFile(delete=False, suffix=".xlsx")
    tmp.close()
    wb.save(tmp.name)
    return tmp.name


def test_system_import_defaults_missing_optional_estimates_to_zero(db_session):
    path = _write_workbook(
        [[date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 75]]
    )
    try:
        result = import_excel(db_session, "system", path)
    finally:
        os.remove(path)

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_system_reimport_replaces_existing_waybill_row(db_session):
    first_path = _write_workbook(
        [[date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 75]]
    )
    second_path = _write_workbook(
        [[date(2026, 4, 20), "SYS001", "线路B", "仓库2", "门店丙,门店丁", 12.0, 80]]
    )
    try:
        assert import_excel(db_session, "system", first_path)["success_rows"] == 1
        assert import_excel(db_session, "system", second_path)["success_rows"] == 1
    finally:
        os.remove(first_path)
        os.remove(second_path)

    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].route_line == "线路B"
    assert rows[0].volume == 12.0
