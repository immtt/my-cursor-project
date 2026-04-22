from typing import Optional

from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.gaode_service import (
    build_markers,
    ensure_route_for_manual_row,
    ensure_route_for_sys_suggest,
    manual_store_visit_sequence,
    map_path_from_markers,
)

STYLE = {"system_line_color": "#1677FF", "manual_line_color": "#FF4D4F"}


def _side_system(db: Session, row: Optional[SysSuggest]) -> dict:
    if not row:
        return {"available": False, "polyline": None, "path": None, "markers": [], "visit_order": None}
    markers = build_markers(row.warehouse_name, row.stores, db)
    stores = [s.strip() for s in row.stores.split(",") if s.strip()]
    if not stores:
        return {"available": False, "polyline": None, "path": None, "markers": markers, "visit_order": []}
    path = map_path_from_markers(markers)
    if not path:
        ok, path = ensure_route_for_sys_suggest(db, row)
        path = path if ok else None
    return {
        "available": bool(path),
        "polyline": None,
        "path": path,
        "markers": markers,
        "visit_order": stores,
    }


def _side_manual(db: Session, row: Optional[ManualRoute]) -> dict:
    if not row:
        return {"available": False, "polyline": None, "path": None, "markers": [], "visit_order": None}
    visit = manual_store_visit_sequence(row.stores, row.delivery_store_order)
    markers = build_markers(row.warehouse_name, row.stores, db, store_visit_order=visit)
    if row.calc_status != 1:
        return {
            "available": False,
            "polyline": None,
            "path": None,
            "markers": markers,
            "visit_order": visit,
        }
    path = map_path_from_markers(markers)
    if not path:
        ok, path = ensure_route_for_manual_row(db, row)
        path = path if ok else None
    return {
        "available": bool(path),
        "polyline": None,
        "path": path,
        "markers": markers,
        "visit_order": visit,
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
        "store_match_rate": round(float(cr.store_match_rate), 2),
        "match_score": round(float(cr.match_score), 4),
        "sys_waybill_no": sys_waybill,
        "manual_waybill_no": manual_waybill,
        "sys_vehicle_type": sys_row.vehicle_type if sys_row else None,
        "manual_vehicle_type": manual_row.vehicle_type if manual_row else None,
        "sys_volume": round(float(sys_row.volume), 2) if sys_row else None,
        "manual_volume": round(float(manual_row.volume), 2) if manual_row else None,
        "warehouse_name": warehouse_name,
        "system": _side_system(db, sys_row),
        "manual": _side_manual(db, manual_row),
        "style": dict(STYLE),
    }
