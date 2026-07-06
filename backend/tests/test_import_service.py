from datetime import date

from openpyxl import Workbook

from app.models.entities import CompareResult, SysSuggest
from app.services.import_service import import_excel


REQUIRED_HEADERS = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]


def _write_workbook(path, headers, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_import_system_without_optional_estimates_keeps_them_null(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        REQUIRED_HEADERS,
        [[date(2026, 4, 20), "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%"]],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance is None
    assert row.est_duration is None


def test_reimport_replaces_existing_system_rows_and_clears_stale_compare_results(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    route_date = date(2026, 4, 20)
    _write_workbook(
        file_path,
        REQUIRED_HEADERS + ["预计公里数", "预计时效"],
        [[route_date, "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%", 40.0, 80]],
    )
    import_excel(db_session, "system", str(file_path))
    original = db_session.query(SysSuggest).one()
    db_session.add(
        CompareResult(
            route_date=route_date,
            sys_id=original.id,
            manual_id=None,
            match_status="none",
            store_match_rate=0.0,
        )
    )
    db_session.commit()

    _write_workbook(
        file_path,
        REQUIRED_HEADERS + ["预计公里数", "预计时效"],
        [[route_date, "SYS001", "线路B", "仓库1", "门店丙", 11.0, "75%", 55.0, 95]],
    )
    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].route_line == "线路B"
    assert rows[0].stores == "门店丙"
    assert rows[0].volume == 11.0
    assert db_session.query(CompareResult).count() == 0
