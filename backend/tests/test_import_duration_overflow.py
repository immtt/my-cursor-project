from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _write_system_workbook(path, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "车辆类型",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ]
    )
    for row in rows:
        sheet.append(row)
    workbook.save(path)


def test_import_rejects_est_duration_overflow_without_aborting_batch(db_session, tmp_path):
    """Huge but finite 预计时效 must be a row error, not an uncaught commit OverflowError."""
    file_path = tmp_path / "duration_overflow.xlsx"
    _write_system_workbook(
        file_path,
        [
            [date(2026, 4, 20), "BAD", "线路A", "仓库1", "门店甲", "4.2米标箱", 10, 50, 12, 1e20],
            [date(2026, 4, 20), "GOOD", "线路A", "仓库1", "门店乙", "4.2米标箱", 11, 51, 13, 30],
        ],
    )

    result = import_excel(db_session, "system", str(file_path), operator="t")

    assert result["total_rows"] == 2
    assert result["success_rows"] == 1
    assert result["failed_rows"] == 1
    assert "预计时效" in result["errors"][0]["reason"]
    assert db_session.query(SysSuggest).count() == 1
    assert db_session.query(SysSuggest).one().waybill_no == "GOOD"


def test_import_rejects_oversized_string_est_duration(db_session, tmp_path):
    file_path = tmp_path / "duration_string_overflow.xlsx"
    _write_system_workbook(
        file_path,
        [
            [
                date(2026, 4, 21),
                "BAD",
                "线路A",
                "仓库1",
                "门店甲",
                "4.2米标箱",
                10,
                50,
                12,
                "12345678901234567890",
            ],
        ],
    )

    result = import_excel(db_session, "system", str(file_path), operator="t")

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert db_session.query(SysSuggest).count() == 0
