import csv
from typing import Optional

from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.services.compare_service import _side_maps_for_compare_rows, compare_row_matches_warehouse
from app.utils.store_match import diff_stores_by_side, same_and_diff_stores_csv


def fetch_results(
    db: Session,
    route_date,
    match_status: Optional[str] = None,
    warehouse_name: Optional[str] = None,
):
    q = db.query(CompareResult).filter(CompareResult.route_date == route_date)
    if match_status:
        q = q.filter(CompareResult.match_status == match_status)
    rows = q.all()
    wh = (warehouse_name or "").strip()
    sys_map, man_map = _side_maps_for_compare_rows(db, rows)
    if wh:
        rows = [r for r in rows if compare_row_matches_warehouse(r, sys_map, man_map, wh)]
    output = []
    for row in rows:
        sys_row = db.query(SysSuggest).filter(SysSuggest.id == row.sys_id).first()
        manual_row = db.query(ManualRoute).filter(ManualRoute.id == row.manual_id).first()
        svt = (sys_row.vehicle_type or "").strip() if sys_row else ""
        mvt = (manual_row.vehicle_type or "").strip() if manual_row else ""
        vehicle_type_consistent = None
        if sys_row and manual_row:
            vehicle_type_consistent = svt == mvt
        same_stores, diff_stores = same_and_diff_stores_csv(
            sys_row.stores if sys_row else "",
            manual_row.stores if manual_row else "",
        )
        only_sys, only_man = diff_stores_by_side(
            sys_row.stores if sys_row else "",
            manual_row.stores if manual_row else "",
        )
        output.append(
            {
                "id": row.id,
                "sys_waybill_no": sys_row.waybill_no if sys_row else None,
                "manual_waybill_no": manual_row.waybill_no if manual_row else None,
                "sys_vehicle_type": sys_row.vehicle_type if sys_row else None,
                "manual_vehicle_type": manual_row.vehicle_type if manual_row else None,
                "match_status": row.match_status,
                "store_match_rate": row.store_match_rate,
                "same_stores": same_stores or None,
                "diff_stores": diff_stores or None,
                "diff_stores_system": only_sys or None,
                "diff_stores_manual": only_man or None,
                "match_score": row.match_score,
                "volume_diff": row.volume_diff,
                "line_consistent": bool(row.line_consistent),
                "vehicle_type_consistent": vehicle_type_consistent,
                "est_distance_diff": row.est_distance_diff,
                "est_duration_diff": row.est_duration_diff,
            }
        )
    return output


def export_results_csv(file_path: str, rows: list[dict]):
    fields = [
        "sys_waybill_no",
        "manual_waybill_no",
        "sys_vehicle_type",
        "manual_vehicle_type",
        "match_status",
        "store_match_rate",
        "same_stores",
        "diff_stores",
        "diff_stores_system",
        "diff_stores_manual",
        "match_score",
        "volume_diff",
        "line_consistent",
        "vehicle_type_consistent",
        "est_distance_diff",
        "est_duration_diff",
    ]
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
