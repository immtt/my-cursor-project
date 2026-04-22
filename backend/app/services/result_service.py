import csv
from typing import Optional

from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest


def fetch_results(db: Session, route_date, match_status: Optional[str] = None):
    q = db.query(CompareResult).filter(CompareResult.route_date == route_date)
    if match_status:
        q = q.filter(CompareResult.match_status == match_status)
    rows = q.all()
    output = []
    for row in rows:
        sys_row = db.query(SysSuggest).filter(SysSuggest.id == row.sys_id).first()
        manual_row = db.query(ManualRoute).filter(ManualRoute.id == row.manual_id).first()
        svt = (sys_row.vehicle_type or "").strip() if sys_row else ""
        mvt = (manual_row.vehicle_type or "").strip() if manual_row else ""
        vehicle_type_consistent = None
        if sys_row and manual_row:
            vehicle_type_consistent = svt == mvt
        output.append(
            {
                "id": row.id,
                "sys_waybill_no": sys_row.waybill_no if sys_row else None,
                "manual_waybill_no": manual_row.waybill_no if manual_row else None,
                "sys_vehicle_type": sys_row.vehicle_type if sys_row else None,
                "manual_vehicle_type": manual_row.vehicle_type if manual_row else None,
                "match_status": row.match_status,
                "store_match_rate": row.store_match_rate,
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
