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
    sys_rows = db.query(SysSuggest).filter(SysSuggest.route_date == route_date).all()
    manual_rows = db.query(ManualRoute).filter(ManualRoute.route_date == route_date).all()

    for sys_row in sys_rows:
        best = None
        best_rate = -1.0
        for man_row in manual_rows:
            rate = calc_store_match_rate(sys_row.stores, man_row.stores)
            if rate > best_rate:
                best = man_row
                best_rate = rate

        if best is None:
            db.add(
                CompareResult(
                    route_date=route_date,
                    sys_id=sys_row.id,
                    manual_id=None,
                    match_status="none",
                    store_match_rate=0.0,
                )
            )
            continue

        status = _match_status(best_rate, threshold)
        volume_diff_rate = None
        if best.volume:
            volume_diff_rate = round(((sys_row.volume - best.volume) / best.volume) * 100, 2)
        distance_diff = None
        duration_diff = None
        if sys_row.est_distance is not None and best.est_distance is not None:
            distance_diff = round(sys_row.est_distance - best.est_distance, 2)
        if sys_row.est_duration is not None and best.est_duration is not None:
            duration_diff = int(sys_row.est_duration - best.est_duration)

        db.add(
            CompareResult(
                route_date=route_date,
                sys_id=sys_row.id,
                manual_id=best.id,
                match_status=status,
                store_match_rate=round(best_rate * 100, 2),
                volume_diff_rate=volume_diff_rate,
                line_consistent=1 if sys_row.route_line == best.route_line else 0,
                est_distance_diff=distance_diff,
                est_duration_diff=duration_diff,
            )
        )
    db.commit()


def overview(db: Session, route_date):
    q = db.query(CompareResult).filter(CompareResult.route_date == route_date)
    rows = q.all()
    total = len(rows)
    full_count = len([r for r in rows if r.match_status == "full"])
    partial_count = len([r for r in rows if r.match_status == "partial"])
    none_count = len([r for r in rows if r.match_status == "none"])
    avg_volume = q.with_entities(func.avg(CompareResult.volume_diff_rate)).scalar()
    avg_dist = q.with_entities(func.avg(CompareResult.est_distance_diff)).scalar()
    avg_dur = q.with_entities(func.avg(CompareResult.est_duration_diff)).scalar()
    return {
        "route_date": route_date,
        "total": total,
        "full_count": full_count,
        "partial_count": partial_count,
        "none_count": none_count,
        "avg_volume_diff": round(avg_volume, 2) if avg_volume is not None else None,
        "avg_distance_diff": round(avg_dist, 2) if avg_dist is not None else None,
        "avg_duration_diff": round(avg_dur, 2) if avg_dur is not None else None,
    }
