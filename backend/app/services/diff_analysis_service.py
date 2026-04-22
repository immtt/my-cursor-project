"""差异分析：一店多车（可闭区间、可单侧；全部时手工与系统分侧判断，不混算运单数）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.entities import ManualRoute, SysSuggest
from app.utils.store_match import normalize_stores

_WbT = Tuple[str, str]  # (waybill_no, "system" | "manual")


def _date_range_inclusive(d0: date, d1: date):
    d = d0
    while d <= d1:
        yield d
        d += timedelta(days=1)


def _scan_row(
    waybill_no: str,
    stores_csv: str,
    data_type: str,
    acc: dict[str, Set[_WbT]],
) -> None:
    wb = (waybill_no or "").strip()
    if not wb:
        return
    for store in normalize_stores(stores_csv or ""):
        acc[store].add((wb, data_type))


def _query_sys_suggest_for_day(
    db: Session, route_date: date, warehouse_name: Optional[str]
):
    q = db.query(SysSuggest).filter(
        SysSuggest.route_date == route_date, SysSuggest.is_active == 1
    )
    wh = (warehouse_name or "").strip()
    if wh:
        q = q.filter(SysSuggest.warehouse_name == wh)
    return q


def _query_manual_route_for_day(
    db: Session, route_date: date, warehouse_name: Optional[str]
):
    q = db.query(ManualRoute).filter(
        ManualRoute.route_date == route_date, ManualRoute.is_active == 1
    )
    wh = (warehouse_name or "").strip()
    if wh:
        q = q.filter(ManualRoute.warehouse_name == wh)
    return q


def _per_day_merged(
    db: Session,
    route_date: date,
    dataset_type: str,
    warehouse_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """单侧 system | manual：同一来源下某店 ≥2 个不同运单即为一店多车（原逻辑）。"""
    if dataset_type not in {"system", "manual"}:
        raise ValueError("dataset_type must be system or manual for merged scan")

    acc: dict[str, Set[_WbT]] = defaultdict(set)

    if dataset_type == "system":
        for row in _query_sys_suggest_for_day(db, route_date, warehouse_name).all():
            _scan_row(row.waybill_no, row.stores, "system", acc)
    else:
        for row in _query_manual_route_for_day(db, route_date, warehouse_name).all():
            _scan_row(row.waybill_no, row.stores, "manual", acc)

    items: List[Dict[str, Any]] = []
    for store_name in sorted(acc.keys()):
        pairs = acc[store_name]
        distinct_wbs = {p[0] for p in pairs}
        if len(distinct_wbs) < 2:
            continue
        sorted_pairs = sorted(pairs, key=lambda x: (x[0], x[1]))
        waybills: List[Dict[str, Any]] = []
        for i, (w, t) in enumerate(sorted_pairs):
            waybills.append(
                {
                    "item_seq": i + 1,
                    "waybill_no": w,
                    "dataset_type": t,
                }
            )
        items.append({"store_name": store_name, "waybills": waybills})

    return items


def _per_day_all_unmerged(
    db: Session, route_date: date, warehouse_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    全部：手工、系统**分别**做一店多车判断，不把两来源运单数加在一起。
    同一店手工 ≥2 车 → 仅返回手工侧运单；系统 ≥2 车 → 仅返回系统侧；可产生两条同店记录（先手工后系统）。
    """
    acc_m: dict[str, Set[str]] = defaultdict(set)
    acc_s: dict[str, Set[str]] = defaultdict(set)

    for row in _query_sys_suggest_for_day(db, route_date, warehouse_name).all():
        wb = (row.waybill_no or "").strip()
        if not wb:
            continue
        for store in normalize_stores(row.stores or ""):
            acc_s[store].add(wb)

    for row in _query_manual_route_for_day(db, route_date, warehouse_name).all():
        wb = (row.waybill_no or "").strip()
        if not wb:
            continue
        for store in normalize_stores(row.stores or ""):
            acc_m[store].add(wb)

    items: List[Dict[str, Any]] = []
    for store_name in sorted(set(acc_m.keys()) | set(acc_s.keys())):
        man_wbs = sorted(w for w in acc_m[store_name] if w)
        sys_wbs = sorted(w for w in acc_s[store_name] if w)
        if len(man_wbs) >= 2:
            waybills = [
                {
                    "item_seq": i + 1,
                    "waybill_no": w,
                    "dataset_type": "manual",
                }
                for i, w in enumerate(man_wbs)
            ]
            items.append({"store_name": store_name, "waybills": waybills})
        if len(sys_wbs) >= 2:
            waybills = [
                {
                    "item_seq": i + 1,
                    "waybill_no": w,
                    "dataset_type": "system",
                }
                for i, w in enumerate(sys_wbs)
            ]
            items.append({"store_name": store_name, "waybills": waybills})

    return items


def list_warehouse_options_for_diff_analysis(
    db: Session, route_date_from: date, route_date_to: date
) -> List[str]:
    """日期闭区间内、有效行，始发仓库去重供筛选下拉。"""
    sys_rows = (
        db.query(SysSuggest.warehouse_name)
        .filter(
            SysSuggest.is_active == 1,
            SysSuggest.route_date >= route_date_from,
            SysSuggest.route_date <= route_date_to,
        )
        .distinct()
        .all()
    )
    man_rows = (
        db.query(ManualRoute.warehouse_name)
        .filter(
            ManualRoute.is_active == 1,
            ManualRoute.route_date >= route_date_from,
            ManualRoute.route_date <= route_date_to,
        )
        .distinct()
        .all()
    )
    out: Set[str] = set()
    for t in sys_rows + man_rows:
        if t[0] is not None and str(t[0]).strip():
            out.add(str(t[0]).strip())
    return sorted(out)


def _vehicle_type_label(v: Any) -> str:
    s = (v or "").strip() if v is not None else ""
    return s if s else "（未填）"


def vehicle_diff_by_type(
    db: Session,
    route_date_from: date,
    route_date_to: date,
    warehouse_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    在排线日闭区间（及可选仓库）内，对有效运单行按「车型」分别统计
    系统建议 / 手工排线的**车次数**（每行 1 车），与 `dataset_type` 无关，用于两侧对比。
    """
    wh = (warehouse_name or "").strip() or None

    def _q_sys():
        q = (
            db.query(SysSuggest.vehicle_type, func.count(SysSuggest.id))
            .filter(
                SysSuggest.is_active == 1,
                SysSuggest.route_date >= route_date_from,
                SysSuggest.route_date <= route_date_to,
            )
        )
        if wh:
            q = q.filter(SysSuggest.warehouse_name == wh)
        return q.group_by(SysSuggest.vehicle_type).all()

    def _q_man():
        q = (
            db.query(ManualRoute.vehicle_type, func.count(ManualRoute.id))
            .filter(
                ManualRoute.is_active == 1,
                ManualRoute.route_date >= route_date_from,
                ManualRoute.route_date <= route_date_to,
            )
        )
        if wh:
            q = q.filter(ManualRoute.warehouse_name == wh)
        return q.group_by(ManualRoute.vehicle_type).all()

    m_sys: Dict[str, int] = {}
    for vt, n in _q_sys():
        label = _vehicle_type_label(vt)
        m_sys[label] = m_sys.get(label, 0) + int(n or 0)

    m_man: Dict[str, int] = {}
    for vt, n in _q_man():
        label = _vehicle_type_label(vt)
        m_man[label] = m_man.get(label, 0) + int(n or 0)

    all_vt = sorted(set(m_sys.keys()) | set(m_man.keys()), key=str)
    by_type: List[Dict[str, Any]] = []
    for vt in all_vt:
        sc = m_sys.get(vt, 0)
        mc = m_man.get(vt, 0)
        by_type.append(
            {
                "vehicle_type": vt,
                "system_count": sc,
                "manual_count": mc,
                "diff": sc - mc,
            }
        )

    sys_tot = sum(m_sys.values())
    man_tot = sum(m_man.values())
    return {
        "by_vehicle_type": by_type,
        "system_total": sys_tot,
        "manual_total": man_tot,
        "total_vehicle_diff": sys_tot - man_tot,
    }


def _trend_by_day(
    db: Session,
    route_date_from: date,
    route_date_to: date,
    warehouse_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    按日：与「一店多车」同判定，分别统计**系统侧**与**手工侧**的门店数（多车店个数），用于趋势图。
    """
    series: List[Dict[str, Any]] = []
    for d in _date_range_inclusive(route_date_from, route_date_to):
        n_sys = len(_per_day_merged(db, d, "system", warehouse_name))
        n_man = len(_per_day_merged(db, d, "manual", warehouse_name))
        series.append(
            {
                "route_date": d.isoformat(),
                "system_multi_vehicle_store_count": n_sys,
                "manual_multi_vehicle_store_count": n_man,
            }
        )
    return series


def list_multi_vehicle_stores(
    db: Session,
    route_date_from: date,
    route_date_to: date,
    dataset_type: str,
    warehouse_name: Optional[str] = None,
) -> Dict[str, Any]:
    if route_date_from > route_date_to:
        raise ValueError("route_date_from must be <= route_date_to")
    if dataset_type not in {"all", "system", "manual"}:
        raise ValueError("dataset_type must be all | system | manual")

    wh = (warehouse_name or "").strip() or None

    all_items: List[Dict[str, Any]] = []
    for d in _date_range_inclusive(route_date_from, route_date_to):
        if dataset_type == "all":
            day_items = _per_day_all_unmerged(db, d, wh)
        else:
            day_items = _per_day_merged(db, d, dataset_type, wh)
        for it in day_items:
            it["route_date"] = d.isoformat()
            all_items.append(it)

    trend_by_day = _trend_by_day(db, route_date_from, route_date_to, wh)
    warehouse_options = list_warehouse_options_for_diff_analysis(
        db, route_date_from, route_date_to
    )
    vehicle_diff = vehicle_diff_by_type(db, route_date_from, route_date_to, wh)
    return {
        "items": all_items,
        "trend_by_day": trend_by_day,
        "warehouse_options": warehouse_options,
        "vehicle_diff": vehicle_diff,
    }
