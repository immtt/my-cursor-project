from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(tmp_path, rows, headers=None):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers or HEADERS)
    for row in rows:
        sheet.append(row)
    file_path = tmp_path / "import.xlsx"
    workbook.save(file_path)
    return str(file_path)


def test_system_import_defaults_missing_optional_metrics(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9, 70]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    assert result["errors"] == []
    row = db_session.query(SysSuggest).filter_by(waybill_no="SYS001").one()
    assert row.est_distance == 0
    assert row.est_duration == 0


def test_import_rejects_blank_required_text_cells(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        [["2026-04-20", None, "线路A", "仓库1", "门店甲", 9, 70]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert "文本字段存在空值" in result["errors"][0]["reason"]
    assert db_session.query(SysSuggest).count() == 0


def test_reimport_replaces_same_date_waybill(db_session, tmp_path):
    first_file = _write_workbook(
        tmp_path,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9, 70]],
    )
    second_file = _write_workbook(
        tmp_path,
        [["2026-04-20", "SYS001", "线路B", "仓库2", "门店乙", 12, 80]],
    )

    assert import_excel(db_session, "system", first_file)["success_rows"] == 1
    assert import_excel(db_session, "system", second_file)["success_rows"] == 1

    rows = db_session.query(SysSuggest).filter_by(route_date=date(2026, 4, 20), waybill_no="SYS001").all()
    assert len(rows) == 1
    assert rows[0].route_line == "线路B"
    assert rows[0].volume == 12
