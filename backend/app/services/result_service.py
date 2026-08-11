import csv
import math

from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest


def _finite_or_none(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def fetch_results(db: Session, route_date, match_status: str | None = None):
    q = db.query(CompareResult).filter(CompareResult.route_date == route_date)
    if match_status:
        q = q.filter(CompareResult.match_status == match_status)
    rows = q.all()
    output = []
    for row in rows:
        sys_row = db.query(SysSuggest).filter(SysSuggest.id == row.sys_id).first()
        manual_row = db.query(ManualRoute).filter(ManualRoute.id == row.manual_id).first()
        output.append(
            {
                "sys_waybill_no": sys_row.waybill_no if sys_row else None,
                "manual_waybill_no": manual_row.waybill_no if manual_row else None,
                "match_status": row.match_status,
                "store_match_rate": _finite_or_none(row.store_match_rate),
                "volume_diff_rate": _finite_or_none(row.volume_diff_rate),
                "line_consistent": bool(row.line_consistent),
                "est_distance_diff": _finite_or_none(row.est_distance_diff),
                "est_duration_diff": row.est_duration_diff,
            }
        )
    return output


def export_results_csv(file_path: str, rows: list[dict]):
    fields = [
        "sys_waybill_no",
        "manual_waybill_no",
        "match_status",
        "store_match_rate",
        "volume_diff_rate",
        "line_consistent",
        "est_distance_diff",
        "est_duration_diff",
    ]
    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
