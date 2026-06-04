from datetime import date

from openpyxl import Workbook

from app.models.entities import ManualRoute, SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(tmp_path, headers, rows, filename="import.xlsx"):
    file_path = tmp_path / filename
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(file_path)
    return str(file_path)


def test_system_import_defaults_missing_optional_metrics_to_zero(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        REQUIRED_HEADERS,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "system", file_path)

    row = db_session.query(SysSuggest).one()
    assert result["success_rows"] == 1
    assert row.est_distance == 0.0
    assert row.est_duration == 0


def test_import_rejects_blank_required_text_cells(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        REQUIRED_HEADERS,
        [["2026-04-20", None, "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "manual", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert "文本字段存在空值" in result["errors"][0]["reason"]
    assert db_session.query(ManualRoute).count() == 0


def test_reimport_updates_existing_waybill_without_duplicate_rows(db_session, tmp_path):
    headers = [*REQUIRED_HEADERS, "预计公里数", "预计时效"]
    first_file = _write_workbook(
        tmp_path,
        headers,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9.0, 70, 40.0, 80]],
        "first.xlsx",
    )
    second_file = _write_workbook(
        tmp_path,
        headers,
        [["2026-04-20", "SYS001", "线路B", "仓库2", "门店乙", 11.0, 75, 50.0, 90]],
        "second.xlsx",
    )

    first_result = import_excel(db_session, "system", first_file)
    second_result = import_excel(db_session, "system", second_file)

    row = db_session.query(SysSuggest).one()
    assert first_result["success_rows"] == 1
    assert second_result["success_rows"] == 1
    assert db_session.query(SysSuggest).count() == 1
    assert row.route_date == date(2026, 4, 20)
    assert row.route_line == "线路B"
    assert row.warehouse_name == "仓库2"
    assert row.stores == "门店乙"
    assert row.volume == 11.0
    assert row.load_rate == 75.0
    assert row.est_distance == 50.0
    assert row.est_duration == 90
