from typing import Optional

from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.gaode_service import (
    build_markers,
    ensure_route_for_manual_row,
    ensure_route_for_sys_suggest,
)

STYLE = {"system_line_color": "#1677FF", "manual_line_color": "#FF4D4F"}


def _side_system(db: Session, row: Optional[SysSuggest]) -> dict:
    if not row:
        return {"available": False, "polyline": None, "path": None, "markers": []}
    markers = build_markers(row.warehouse_name, row.stores, db)
    stores = [s.strip() for s in row.stores.split(",") if s.strip()]
    if not stores:
        return {"available": False, "polyline": None, "path": None, "markers": markers}
    ok, path = ensure_route_for_sys_suggest(db, row)
    return {
        "available": bool(ok and path),
        "polyline": None,
        "path": path if ok else None,
        "markers": markers,
    }


def _side_manual(db: Session, row: Optional[ManualRoute]) -> dict:
    if not row:
        return {"available": False, "polyline": None, "path": None, "markers": []}
    markers = build_markers(row.warehouse_name, row.stores, db)
    if row.calc_status != 1:
        return {"available": False, "polyline": None, "path": None, "markers": markers}
    ok, path = ensure_route_for_manual_row(db, row)
    return {
        "available": bool(ok and path),
        "polyline": None,
        "path": path if ok else None,
        "markers": markers,
    }


def build_route_map_payload(db: Session, compare_result_id: int) -> dict:
    cr = db.query(CompareResult).filter(CompareResult.id == compare_result_id).first()
    if not cr:
        raise ValueError("NOT_FOUND")
    sys_row = db.query(SysSuggest).filter(SysSuggest.id == cr.sys_id).first() if cr.sys_id else None
    manual_row = db.query(ManualRoute).filter(ManualRoute.id == cr.manual_id).first() if cr.manual_id else None
    if not sys_row and not manual_row:
        raise ValueError("NOT_FOUND")

    warehouse_name = ""
    if sys_row:
        warehouse_name = sys_row.warehouse_name
    elif manual_row:
        warehouse_name = manual_row.warehouse_name

    sys_waybill = sys_row.waybill_no if sys_row else None
    manual_waybill = manual_row.waybill_no if manual_row else None

    return {
        "route_date": cr.route_date.isoformat(),
        "match_status": cr.match_status,
        "sys_waybill_no": sys_waybill,
        "manual_waybill_no": manual_waybill,
        "warehouse_name": warehouse_name,
        "system": _side_system(db, sys_row),
        "manual": _side_manual(db, manual_row),
        "style": dict(STYLE),
    }
