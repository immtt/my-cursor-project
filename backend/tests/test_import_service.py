from datetime import date

from openpyxl import Workbook

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.compare_service import run_compare
from app.services.import_service import import_excel


def _write_workbook(tmp_path, headers, rows):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    file_path = tmp_path / "import.xlsx"
    workbook.save(file_path)
    return str(file_path)


def test_system_import_missing_optional_estimates_remains_unavailable(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [[date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%"]],
    )

    result = import_excel(db_session, "system", file_path)

    assert result["success_rows"] == 1
    assert result["failed_rows"] == 0
    sys_row = db_session.query(SysSuggest).one()
    assert sys_row.est_distance is None
    assert sys_row.est_duration is None

    db_session.add(
        ManualRoute(
            route_date=date(2026, 4, 20),
            waybill_no="MAN001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店乙,门店甲",
            volume=10.0,
            load_rate=68,
            est_distance=42,
            est_duration=85,
            calc_status=1,
        )
    )
    db_session.commit()

    run_compare(db_session, date(2026, 4, 20), 0.5)

    compare_row = db_session.query(CompareResult).one()
    assert compare_row.match_status == "full"
    assert compare_row.est_distance_diff is None
    assert compare_row.est_duration_diff is None


def test_import_rejects_blank_required_text_cells(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"],
        [[date(2026, 4, 20), None, "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%"]],
    )

    result = import_excel(db_session, "manual", file_path)

    assert result["success_rows"] == 0
    assert result["failed_rows"] == 1
    assert result["errors"] == [{"row": 2, "reason": "文本字段存在空值"}]
    assert db_session.query(ManualRoute).count() == 0
