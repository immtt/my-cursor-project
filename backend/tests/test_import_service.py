import math

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def test_import_rejects_non_finite_numbers_without_losing_valid_rows(db_session, tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "配送体积",
            "装载率",
            "预计公里数",
            "预计时效",
        ]
    )
    sheet.append(["2026-04-20", "VALID", "线路A", "仓库1", "门店甲", 10, 75, 40, 80])
    sheet.append(["2026-04-20", "NAN", "线路A", "仓库1", "门店甲", "NaN", 75, 40, 80])
    sheet.append(["2026-04-20", "INF_RATE", "线路A", "仓库1", "门店甲", 10, "1e309", 40, 80])
    sheet.append(["2026-04-20", "INF_DISTANCE", "线路A", "仓库1", "门店甲", 10, 75, "1e309", 80])
    file_path = tmp_path / "routes.xlsx"
    workbook.save(file_path)

    result = import_excel(db_session, "system", str(file_path))

    assert result["total_rows"] == 4
    assert result["success_rows"] == 1
    assert result["failed_rows"] == 3
    assert [error["row"] for error in result["errors"]] == [3, 4, 5]

    rows = db_session.query(SysSuggest).all()
    assert len(rows) == 1
    assert rows[0].waybill_no == "VALID"
    assert math.isfinite(rows[0].volume)
    assert math.isfinite(rows[0].load_rate)
    assert math.isfinite(rows[0].est_distance)
