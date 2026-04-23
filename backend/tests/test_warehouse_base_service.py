"""仓库主数据 API / 服务 烟测。"""

import os
import tempfile

from openpyxl import Workbook

from app.models.entities import WarehouseBase
from app.services.warehouse_base_service import (
    batch_supplement_warehouse_base_coordinates,
    create_warehouse_base,
    delete_warehouse_base,
    get_by_warehouse_code,
    import_warehouse_workbook,
    list_warehouse_base_filter_options,
    list_warehouse_bases,
    update_warehouse_base,
    warehouse_base_to_item,
)


def _w(**kwargs):
    o = {
        "warehouse_name": "名",
        "group_name": "集团",
        "address": "某路1号",
        "brand": "某品牌",
    }
    o.update(kwargs)
    return o


def test_warehouse_base_crud_and_list(db_session):
    r = create_warehouse_base(
        db_session,
        _w(
            warehouse_code="T001",
            warehouse_name="测试仓",
            group_name="某集团",
            brand="品牌甲",
            address="上海市",
            status="运营中",
        ),
    )
    assert r.id
    assert get_by_warehouse_code(db_session, "T001") is not None
    g = warehouse_base_to_item(r)
    assert g["group_name"] == "某集团"
    assert g["brand"] == "品牌甲"
    assert g["address"] == "上海市"
    # 无 AMAP_KEY 时走模拟地理编码，「仓库坐标」会写入
    assert g.get("coordinate_raw")
    assert "," in str(g["coordinate_raw"])

    total, rows = list_warehouse_bases(db_session, skip=0, limit=10, group_name="某集团")
    assert total >= 1
    assert any(x.warehouse_code == "T001" for x in rows)

    u = update_warehouse_base(
        db_session,
        r.id,
        {"group_name": "新集团", "brand": "品牌乙", "area_sqm": 100.5},
    )
    assert u
    assert u.group_name == "新集团"
    assert u.brand == "品牌乙"
    assert u.area_sqm == 100.5

    assert delete_warehouse_base(db_session, r.id) is True
    assert db_session.query(WarehouseBase).filter(WarehouseBase.id == r.id).first() is None


def test_warehouse_base_create_without_code(db_session):
    r = create_warehouse_base(
        db_session,
        _w(warehouse_name="无码仓", address="上海", group_name="G", brand="B"),
    )
    assert r.warehouse_code is None
    assert get_by_warehouse_code(db_session, "任意") is None
    g = warehouse_base_to_item(r)
    assert g["warehouse_code"] is None


def test_warehouse_base_filters_and_combined_and(db_session):
    create_warehouse_base(
        db_session,
        _w(
            warehouse_code="A1",
            warehouse_name="上海仓",
            group_name="集团甲",
            brand="东大区",
            address="上海",
            status="运营中",
        ),
    )
    create_warehouse_base(
        db_session,
        _w(
            warehouse_code="B1",
            warehouse_name="北京仓",
            group_name="集团乙",
            brand="华北大区",
            address="北京",
            status="运营中",
        ),
    )
    t1, _ = list_warehouse_bases(
        db_session, skip=0, limit=10, group_name="集团甲", status="运营中"
    )
    t2, _ = list_warehouse_bases(
        db_session, skip=0, limit=10, group_name="集团乙", warehouse="北京"
    )
    assert t1 == 1
    assert t2 == 1
    t3, rows3 = list_warehouse_bases(
        db_session, skip=0, limit=10, group_name="集团甲", warehouse="北京"
    )
    assert t3 == 0
    assert len(rows3) == 0
    t4, rows4 = list_warehouse_bases(
        db_session, skip=0, limit=10, group_name="集团甲", brand="东大区"
    )
    assert t4 == 1
    assert len(rows4) == 1
    t5, _ = list_warehouse_bases(
        db_session, skip=0, limit=10, group_name="集团甲", brand="华北大区"
    )
    assert t5 == 0
    opt = list_warehouse_base_filter_options(db_session)
    wh = opt.get("warehouses") or []
    assert any(
        p.get("warehouse_code") == "A1" and p.get("warehouse_name") == "上海仓" for p in wh
    )
    assert "集团甲" in (opt.get("group_name") or [])
    so = opt.get("brand") or []
    assert "东大区" in so and "华北大区" in so


def test_batch_supplement_warehouse_base_coordinates(db_session):
    r = create_warehouse_base(
        db_session,
        _w(warehouse_name="补座仓", group_name="G", address="浙江杭州某路", brand="B"),
    )
    r.coordinate_raw = None
    db_session.add(r)
    db_session.commit()
    out = batch_supplement_warehouse_base_coordinates(
        db_session, only_missing=True, group_name="G"
    )
    assert out["ok"] is True
    assert out["updated"] == 1
    db_session.refresh(r)
    assert r.coordinate_raw and "," in r.coordinate_raw


def _write_min_warehouse_workbook(path: str, data_rows: list) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "仓管理"
    ws.append(["仓库代码", "仓库名称", "集团", "仓库地址", "品牌"])
    for r in data_rows:
        ws.append(r)
    wb.save(path)
    wb.close()


def test_warehouse_base_import_replaces_table(db_session):
    create_warehouse_base(
        db_session,
        _w(
            warehouse_code="OLD1",
            warehouse_name="旧仓一",
            group_name="集团X",
            brand="B",
            address="旧地址1",
        ),
    )
    create_warehouse_base(
        db_session,
        _w(
            warehouse_code="OLD2",
            warehouse_name="旧仓二",
            group_name="集团X",
            brand="B",
            address="旧地址2",
        ),
    )
    assert db_session.query(WarehouseBase).count() == 2

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        _write_min_warehouse_workbook(
            path, [["N1", "新仓", "某集团", "上海市路1号", "新品牌"]]
        )
        out = import_warehouse_workbook(db_session, path, "测试导入")
        assert out["ok"] is True
        assert out["upserted_rows"] == 1
        assert out.get("replaced_table") is True
        assert db_session.query(WarehouseBase).count() == 1
        r0 = get_by_warehouse_code(db_session, "N1")
        assert r0 is not None
        assert r0.warehouse_name == "新仓"
        assert r0.group_name == "某集团"
    finally:
        os.remove(path)


def test_warehouse_base_import_header_only_clears_previous(db_session):
    create_warehouse_base(
        db_session,
        _w(warehouse_code="ONLY", warehouse_name="独仓", group_name="G", brand="B", address="A"),
    )
    assert db_session.query(WarehouseBase).count() == 1
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        _write_min_warehouse_workbook(path, [])
        out = import_warehouse_workbook(db_session, path, "空表")
        assert out["ok"] is True
        assert out["upserted_rows"] == 0
        assert out["skipped_incomplete"] == 0
        assert db_session.query(WarehouseBase).count() == 0
    finally:
        os.remove(path)
