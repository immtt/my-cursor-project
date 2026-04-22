from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest
from app.utils.store_match import calc_store_match_rate


def _match_status(rate: float) -> str:
    """PRD 3.1.2：完全匹配=100%；部分匹配=0<匹配度<100%；不匹配=0%。不使用业务阈值分档。"""
    if rate >= 0.999:
        return "full"
    if rate > 0:
        return "partial"
    return "none"


def run_compare(db: Session, route_date, threshold: float = 0.5):
    """threshold 仅保留 API 兼容；匹配度与状态分档遵循 PRD，不再使用该阈值。"""
    _ = threshold
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

        status = _match_status(best_rate)
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


def warehouse_options_for_route_date(db: Session, route_date) -> List[str]:
    return warehouse_options_for_date_range(db, route_date, route_date)


def warehouse_options_for_date_range(
    db: Session, route_date_from, route_date_to
) -> List[str]:
    """闭区间内、当前有效行涉及的全部始发仓名。"""
    sys_names = [
        str(n).strip()
        for (n,) in db.query(SysSuggest.warehouse_name)
        .filter(
            SysSuggest.route_date >= route_date_from,
            SysSuggest.route_date <= route_date_to,
            SysSuggest.is_active == 1,
        )
        .distinct()
        .all()
        if n
    ]
    man_names = [
        str(n).strip()
        for (n,) in db.query(ManualRoute.warehouse_name)
        .filter(
            ManualRoute.route_date >= route_date_from,
            ManualRoute.route_date <= route_date_to,
            ManualRoute.is_active == 1,
        )
        .distinct()
        .all()
        if n
    ]
    return sorted(set(sys_names) | set(man_names))


def _side_maps_for_compare_rows(db: Session, rows: List[CompareResult]) -> Tuple[Dict[int, SysSuggest], Dict[int, ManualRoute]]:
    sys_ids = [r.sys_id for r in rows if r.sys_id is not None]
    man_ids = [r.manual_id for r in rows if r.manual_id is not None]
    sys_map: Dict[int, SysSuggest] = {}
    if sys_ids:
        for s in db.query(SysSuggest).filter(SysSuggest.id.in_(sys_ids)).all():
            sys_map[s.id] = s
    man_map: Dict[int, ManualRoute] = {}
    if man_ids:
        for m in db.query(ManualRoute).filter(ManualRoute.id.in_(man_ids)).all():
            man_map[m.id] = m
    return sys_map, man_map


def compare_row_matches_warehouse(
    row: CompareResult,
    sys_map: Dict[int, SysSuggest],
    man_map: Dict[int, ManualRoute],
    warehouse_name: str,
) -> bool:
    wh = (warehouse_name or "").strip()
    if not wh:
        return True
    sys_row = sys_map.get(row.sys_id) if row.sys_id is not None else None
    man_row = man_map.get(row.manual_id) if row.manual_id is not None else None
    s = (sys_row.warehouse_name or "").strip() if sys_row else ""
    m = (man_row.warehouse_name or "").strip() if man_row else ""
    return s == wh or m == wh


def _count_active_routes(
    db: Session, route_date, warehouse_name: Optional[str]
) -> Tuple[int, int]:
    """当日有效运单行数：系统、手工。可选按始发仓库精确匹配。"""
    return _count_active_routes_range(db, route_date, route_date, warehouse_name)


def _count_active_routes_range(
    db: Session,
    route_date_from,
    route_date_to,
    warehouse_name: Optional[str],
) -> Tuple[int, int]:
    """闭区间内各日有效运单行数求和。可选按始发仓库精确匹配。"""
    wh = (warehouse_name or "").strip()
    q_s = db.query(SysSuggest).filter(
        SysSuggest.route_date >= route_date_from,
        SysSuggest.route_date <= route_date_to,
        SysSuggest.is_active == 1,
    )
    q_m = db.query(ManualRoute).filter(
        ManualRoute.route_date >= route_date_from,
        ManualRoute.route_date <= route_date_to,
        ManualRoute.is_active == 1,
    )
    if wh:
        q_s = q_s.filter(SysSuggest.warehouse_name == wh)
        q_m = q_m.filter(ManualRoute.warehouse_name == wh)
    return q_s.count(), q_m.count()


def overview(
    db: Session,
    route_date_from,
    route_date_to,
    warehouse_name: Optional[str] = None,
):
    wh = (warehouse_name or "").strip()
    all_rows = (
        db.query(CompareResult)
        .filter(
            CompareResult.route_date >= route_date_from,
            CompareResult.route_date <= route_date_to,
        )
        .all()
    )
    sys_map, man_map = _side_maps_for_compare_rows(db, all_rows)
    rows = all_rows
    if wh:
        rows = [r for r in all_rows if compare_row_matches_warehouse(r, sys_map, man_map, wh)]
    total = len(rows)
    full_count = sum(1 for r in rows if r.match_status == "full")
    partial_count = sum(1 for r in rows if r.match_status == "partial")
    none_count = sum(1 for r in rows if r.match_status == "none")
    vols = [r.volume_diff for r in rows if r.volume_diff is not None]
    avg_volume = round(sum(vols) / len(vols), 2) if vols else 0.0
    total_volume = round(sum(vols), 2) if vols else 0.0
    dists = [r.est_distance_diff for r in rows if r.est_distance_diff is not None]
    avg_dist = round(sum(dists) / len(dists), 2) if dists else 0.0
    total_distance = round(sum(dists), 2) if dists else 0.0
    durs = [int(r.est_duration_diff) for r in rows if r.est_duration_diff is not None]
    avg_dur = round(float(sum(durs)) / len(durs), 2) if durs else 0.0
    total_duration = int(sum(durs)) if durs else 0
    n_sys, n_man = _count_active_routes_range(
        db, route_date_from, route_date_to, wh if wh else None
    )
    total_trip_diff = n_sys - n_man
    opts = warehouse_options_for_date_range(db, route_date_from, route_date_to)
    return {
        "route_date": route_date_from,
        "route_date_from": route_date_from,
        "route_date_to": route_date_to,
        "total": total,
        "full_count": full_count,
        "partial_count": partial_count,
        "none_count": none_count,
        "total_trip_diff": total_trip_diff,
        "total_volume_diff": total_volume,
        "total_distance_diff": total_distance,
        "total_duration_diff": total_duration,
        "avg_volume_diff": avg_volume,
        "avg_distance_diff": avg_dist,
        "avg_duration_diff": avg_dur,
        "warehouse_options": opts,
    }
