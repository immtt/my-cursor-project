from datetime import date

from openpyxl import Workbook

from app.models.entities import CompareResult, SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = [
    "排线日期",
    "运单号",
    "归属线路",
    "始发仓库",
    "拼载门店",
    "配送体积",
    "装载率",
]


def _write_workbook(path, headers, rows):
    wb = Workbook()
    sheet = wb.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    wb.save(path)


def test_system_import_keeps_missing_estimates_null(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        REQUIRED_HEADERS,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["errors"] == []
    row = db_session.query(SysSuggest).one()
    assert row.est_distance is None
    assert row.est_duration is None


def test_reimport_replaces_existing_waybill_and_clears_stale_compare(db_session, tmp_path):
    first_file = tmp_path / "system-first.xlsx"
    second_file = tmp_path / "system-second.xlsx"
    _write_workbook(
        first_file,
        REQUIRED_HEADERS + ["预计公里数", "预计时效"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9.0, 70, 40, 80]],
    )
    _write_workbook(
        second_file,
        REQUIRED_HEADERS + ["预计公里数", "预计时效"],
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 12.0, 75, 45, 90]],
    )

    import_excel(db_session, "system", str(first_file))
    db_session.add(
        CompareResult(
            route_date=date(2026, 4, 20),
            sys_id=1,
            manual_id=None,
            match_status="none",
            store_match_rate=0.0,
        )
    )
    db_session.commit()

    result = import_excel(db_session, "system", str(second_file))

    assert result["errors"] == []
    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].waybill_no == "SYS001"
    assert rows[0].volume == 12.0
    assert rows[0].est_distance == 45
    assert rows[0].est_duration == 90
    assert db_session.query(CompareResult).count() == 0


def test_import_unreadable_excel_returns_validation_error(db_session, tmp_path):
    file_path = tmp_path / "broken.xlsx"
    file_path.write_text("not a workbook")

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 0
    assert result["errors"]
    assert "无法读取Excel文件" in result["errors"][0]["reason"]
