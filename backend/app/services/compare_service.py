from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.utils.store_match import calc_store_match_rate


def _match_status(rate: float, threshold: float) -> str:
    if rate >= 0.999:
        return "full"
    if rate >= threshold:
        return "partial"
    return "none"


def run_compare(db: Session, route_date, threshold: float = 0.5):
    db.query(CompareResult).filter(CompareResult.route_date == route_date).delete()
    sys_rows = db.query(SysSuggest).filter(SysSuggest.route_date == route_date, SysSuggest.is_active == 1).all()
    manual_rows = db.query(ManualRoute).filter(ManualRoute.route_date == route_date, ManualRoute.is_active == 1).all()
    available_manual_ids = {row.id for row in manual_rows}
    inserted = 0

    for sys_row in sys_rows:
        best = None
        best_rate = -1.0
        best_abs_volume_diff = float("inf")
        for man_row in manual_rows:
            if man_row.id not in available_manual_ids:
                continue
            rate = calc_store_match_rate(sys_row.stores, man_row.stores)
            abs_volume_diff = abs(sys_row.volume - man_row.volume)
            if rate > best_rate:
                best = man_row
                best_rate = rate
                best_abs_volume_diff = abs_volume_diff
            elif rate == best_rate:
                if abs_volume_diff < best_abs_volume_diff:
                    best = man_row
                    best_abs_volume_diff = abs_volume_diff
                elif abs_volume_diff == best_abs_volume_diff and best:
                    sys_vt = (sys_row.vehicle_type or "").strip()
                    b_vt = (best.vehicle_type or "").strip()
                    m_vt = (man_row.vehicle_type or "").strip()
                    if sys_vt == m_vt and sys_vt != b_vt:
                        best = man_row
                    elif sys_vt != m_vt and sys_vt == b_vt:
                        pass
                    elif man_row.waybill_no < best.waybill_no:
                        best = man_row

        if best is None:
            db.add(
                CompareResult(
                    route_date=route_date,
                    sys_id=sys_row.id,
                    manual_id=None,
                    match_status="none",
                    store_match_rate=0.0,
                    match_score=0.0,
                )
            )
            inserted += 1
            continue

        status = _match_status(best_rate, threshold)
        volume_diff = None
        if best.volume != 0:
            volume_diff = round(sys_row.volume - best.volume, 2)
        distance_diff = None
        duration_diff = None
        if best.est_distance is not None:
            distance_diff = round(sys_row.est_distance - best.est_distance, 2)
        if best.est_duration is not None:
            duration_diff = int(sys_row.est_duration - best.est_duration)

        db.add(
            CompareResult(
                route_date=route_date,
                sys_id=sys_row.id,
                manual_id=best.id,
                match_status=status,
                store_match_rate=round(best_rate * 100, 2),
                match_score=best_rate,
                volume_diff=volume_diff,
                line_consistent=1 if sys_row.route_line == best.route_line else 0,
                est_distance_diff=distance_diff,
                est_duration_diff=duration_diff,
            )
        )
        available_manual_ids.remove(best.id)
        inserted += 1

    for mid in list(available_manual_ids):
        man_row = next((m for m in manual_rows if m.id == mid), None)
        if not man_row:
            continue
        db.add(
            CompareResult(
                route_date=route_date,
                sys_id=None,
                manual_id=man_row.id,
                match_status="none",
                store_match_rate=0.0,
                match_score=0.0,
            )
        )
        inserted += 1

    db.commit()
    return inserted


def overview(db: Session, route_date):
    q = db.query(CompareResult).filter(CompareResult.route_date == route_date)
    rows = q.all()
    total = len(rows)
    full_count = len([r for r in rows if r.match_status == "full"])
    partial_count = len([r for r in rows if r.match_status == "partial"])
    none_count = len([r for r in rows if r.match_status == "none"])
    avg_volume = q.with_entities(func.avg(CompareResult.volume_diff)).scalar()
    avg_dist = q.with_entities(func.avg(CompareResult.est_distance_diff)).scalar()
    avg_dur = q.with_entities(func.avg(CompareResult.est_duration_diff)).scalar()
    return {
        "route_date": route_date,
        "total": total,
        "full_count": full_count,
        "partial_count": partial_count,
        "none_count": none_count,
        "avg_volume_diff": round(avg_volume or 0, 2),
        "avg_distance_diff": round(avg_dist or 0, 2),
        "avg_duration_diff": round(avg_dur or 0, 2),
    }
