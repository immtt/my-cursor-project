import os
import tempfile
from datetime import date

from openpyxl import Workbook

from app.models.entities import SysSuggest
from app.services.import_service import import_excel


def test_import_accepts_parenthetical_unit_headers(db_session):
    """表头含 (m³)、(%) 等后缀时应与 配送体积、装载率 对齐。"""
    path = os.path.join(tempfile.gettempdir(), "sys_units.xlsx")
    wb = Workbook()
    ws = wb.active
    ws.append(
        [
            "排线日期",
            "运单号",
            "归属线路",
            "始发仓库",
            "拼载门店",
            "配送体积(m³)",
            "装载率(%)",
            "预计公里数",
            "预计时效(分钟)",
        ]
    )
    ws.append(
        [
            date(2026, 4, 21),
            "YTS001",
            "线路A",
            "仓库1",
            "门店甲",
            14.19,
            76,
            78.19,
            92,
        ]
    )
    wb.save(path)

    out = import_excel(db_session, "system", path, operator="t")
    assert out["failed_rows"] == 0
    row = db_session.query(SysSuggest).filter(SysSuggest.waybill_no == "YTS001").one()
    assert row.volume == 14.19
    assert row.load_rate == 76.0
    assert row.est_distance == 78.19
    assert row.est_duration == 92
