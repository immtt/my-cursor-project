from datetime import date

from openpyxl import Workbook

from app.models.entities import CompareResult, SysSuggest
from app.services.import_service import import_excel


def _write_workbook(path, rows, include_estimates=False):
    headers = ["排线日期", "运单号", "归属线路", "始发仓库", "拼载门店", "配送体积", "装载率"]
    if include_estimates:
        headers.extend(["预计公里数", "预计时效"])

    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    wb.save(path)


def test_system_import_preserves_missing_optional_estimates(db_session, tmp_path):
    file_path = tmp_path / "system.xlsx"
    _write_workbook(
        file_path,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", 9.0, "70%"]],
    )

    result = import_excel(db_session, "system", str(file_path))

    assert result["success_rows"] == 1
    row = db_session.query(SysSuggest).one()
    assert row.est_distance is None
    assert row.est_duration is None


def test_import_replaces_existing_waybill_and_clears_stale_compare_results(db_session, tmp_path):
    first_path = tmp_path / "system-first.xlsx"
    second_path = tmp_path / "system-second.xlsx"
    _write_workbook(
        first_path,
        [["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲", 9.0, "70%", 40, 80]],
        include_estimates=True,
    )
    _write_workbook(
        second_path,
        [["2026-04-20", "SYS001", "线路B", "仓库2", "门店乙", 12.0, "80%", 55, 95]],
        include_estimates=True,
    )

    import_excel(db_session, "system", str(first_path))
    db_session.add(
        CompareResult(
            route_date=date(2026, 4, 20),
            sys_id=1,
            manual_id=None,
            match_status="none",
            store_match_rate=0,
        )
    )
    db_session.commit()

    result = import_excel(db_session, "system", str(second_path))

    assert result["success_rows"] == 1
    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].route_line == "线路B"
    assert rows[0].warehouse_name == "仓库2"
    assert rows[0].stores == "门店乙"
    assert db_session.query(CompareResult).count() == 0
