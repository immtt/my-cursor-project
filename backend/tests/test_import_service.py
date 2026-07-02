from datetime import date

from openpyxl import Workbook

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.compare_service import run_compare
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]
REQUIRED_ROW = [date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, 70]


def _write_workbook(tmp_path, headers, row):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    sheet.append(row)
    file_path = tmp_path / "import.xlsx"
    workbook.save(file_path)
    return file_path


def test_system_import_missing_optional_estimates_remain_none(db_session, tmp_path):
    file_path = _write_workbook(tmp_path, REQUIRED_HEADERS, REQUIRED_ROW)

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance is None
    assert row.est_duration is None


def test_system_import_blank_optional_estimates_remain_none(db_session, tmp_path):
    file_path = _write_workbook(
        tmp_path,
        REQUIRED_HEADERS + ["预计公里数", "预计时效"],
        REQUIRED_ROW + ["", None],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance is None
    assert row.est_duration is None


def test_compare_skips_estimate_diffs_when_system_estimates_missing(db_session):
    db_session.add(
        SysSuggest(
            route_date=date(2026, 4, 20),
            waybill_no="SYS001",
            route_line="线路A",
            warehouse_name="仓库1",
            stores="门店甲,门店乙",
            volume=9.0,
            load_rate=70,
            est_distance=None,
            est_duration=None,
        )
    )
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

    result = db_session.query(CompareResult).one()
    assert result.est_distance_diff is None
    assert result.est_duration_diff is None
