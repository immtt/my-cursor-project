import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def _create_system_excel(path: str, volume: float):
    wb = Workbook()
    ws = wb.active
    ws.append(
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
    ws.append(["2026-04-20", "SYS001", "线路A", "仓库1", "门店甲,门店乙", "4.2米标箱", volume, "70%", 30, 60])
    wb.save(path)


def test_import_cover_marks_old_batch_inactive(db_session):
    file_a = os.path.join(tempfile.gettempdir(), "sys_a.xlsx")
    file_b = os.path.join(tempfile.gettempdir(), "sys_b.xlsx")
    _create_system_excel(file_a, 8.0)
    _create_system_excel(file_b, 9.0)

    import_excel(db_session, "system", file_a, operator="u1")
    import_excel(db_session, "system", file_b, operator="u1")

    rows = db_session.query(SysSuggest).filter(SysSuggest.route_date == date(2026, 4, 20)).all()
    active_rows = [r for r in rows if r.is_active == 1]
    inactive_rows = [r for r in rows if r.is_active == 0]
    assert len(rows) == 2
    assert len(active_rows) == 1
    assert len(inactive_rows) == 1
    assert active_rows[0].volume == 9.0
