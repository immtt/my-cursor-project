"""仓店距离 Excel：同文件重复有向边不得因唯一约束回滚整张表。"""

import os
import tempfile

from openpyxl import Workbook

from app.models.entities import StoreCoordinate, StorePairDistance
from app.services.store_distance_excel import import_workbook_path

_HEADERS = ["客户1", "客户1坐标", "客户2", "客户2坐标", "距离（km）"]


def _write_distance_xlsx(path: str, data_rows: list[tuple]) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "仓店距离"
    ws.append(_HEADERS)
    for row in data_rows:
        ws.append(list(row))
    wb.save(path)
    wb.close()


def test_import_duplicate_directed_pair_last_wins_and_keeps_siblings(db_session):
    """Two rows for the same 客户1→客户2 must not abort the sheet.

    The first edge stays pending (coords already exist, so no flush) when the
    second row is seen. Inserting another StorePairDistance hits the unique
    constraint and rolls back every other distance and coordinate in the file.
    """
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        _write_distance_xlsx(
            path,
            [
                ("门店A", "117.1,31.6", "门店B", "117.2,31.7", 10),
                ("门店A", "117.1,31.6", "门店B", "117.2,31.7", 12.5),
                ("门店C", "118.0,32.0", "门店D", "118.1,32.1", 3),
            ],
        )
        stats = import_workbook_path(db_session, path, "单元测试")
        assert stats["distance_rows"] == 3
        assert stats["skipped_rows"] == 0

        pairs = {
            (p.store_from, p.store_to): p.distance_km
            for p in db_session.query(StorePairDistance).all()
        }
        assert pairs == {("门店A", "门店B"): 12.5, ("门店C", "门店D"): 3.0}
        names = {
            c.store_name
            for c in db_session.query(StoreCoordinate).all()
        }
        assert names == {"门店A", "门店B", "门店C", "门店D"}
    finally:
        if os.path.exists(path):
            os.remove(path)
