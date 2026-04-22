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
    在排线日闭区间（及可选仓库）内，对有效**运单行**按「车型」分组，统计
    系统/手工侧 **运单数**（每行 1 单，与 `dataset_type` 无关）。

    `system_total` / `manual_total` 为各侧**运单总数**（所有车型之和）。
    """
    wh = (warehouse_name or "").strip() or None

    def _q_sys_groups():
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

    def _q_man_groups():
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
    for vt, n in _q_sys_groups():
        label = _vehicle_type_label(vt)
        m_sys[label] = m_sys.get(label, 0) + int(n or 0)

    m_man: Dict[str, int] = {}
    for vt, n in _q_man_groups():
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


def store_diff_summary(
    db: Session,
    route_date_from: date,
    route_date_to: date,
    warehouse_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    配送**门店差异**：在相同区间与仓库下，将各运单 `stores` 展开后按名去重，
    分别统计系统侧、手工侧涉及的**不重复门店数**；用于对照运单/车辆数变化与配送面变化。

    与 `vehicle_diff` 独立：此处只看「店」，不区分车型。
    """
    wh = (warehouse_name or "").strip() or None
    sys_stores: Set[str] = set()
    man_stores: Set[str] = set()

    q_sys = db.query(SysSuggest).filter(
        SysSuggest.is_active == 1,
        SysSuggest.route_date >= route_date_from,
        SysSuggest.route_date <= route_date_to,
    )
    if wh:
        q_sys = q_sys.filter(SysSuggest.warehouse_name == wh)
    for row in q_sys.all():
        for store in normalize_stores(row.stores or ""):
            sys_stores.add(store)

    q_man = db.query(ManualRoute).filter(
        ManualRoute.is_active == 1,
        ManualRoute.route_date >= route_date_from,
        ManualRoute.route_date <= route_date_to,
    )
    if wh:
        q_man = q_man.filter(ManualRoute.warehouse_name == wh)
    for row in q_man.all():
        for store in normalize_stores(row.stores or ""):
            man_stores.add(store)

    sc = len(sys_stores)
    mc = len(man_stores)
    only_in_system = sorted(sys_stores - man_stores)
    only_in_manual = sorted(man_stores - sys_stores)
    return {
        "system_store_count": sc,
        "manual_store_count": mc,
        "diff": sc - mc,
        "only_in_system": only_in_system,
        "only_in_manual": only_in_manual,
    }


def _vehicle_store_trend_by_day(
    db: Session,
    route_date_from: date,
    route_date_to: date,
    warehouse_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    按日：与车辆差异 / 门店差异同口径。每日系统/手工的运单行数、以及当日拼载门店去重数。
    供前端在一张图内画「运单 + 门店」四序列趋势（双纵轴）。
    """
    wh = (warehouse_name or "").strip() or None
    series: List[Dict[str, Any]] = []
    for d in _date_range_inclusive(route_date_from, route_date_to):
        q_sys = db.query(SysSuggest).filter(
            SysSuggest.is_active == 1, SysSuggest.route_date == d
        )
        if wh:
            q_sys = q_sys.filter(SysSuggest.warehouse_name == wh)
        sys_rows = q_sys.all()
        sys_st: Set[str] = set()
        for row in sys_rows:
            for store in normalize_stores(row.stores or ""):
                sys_st.add(store)

        q_man = db.query(ManualRoute).filter(
            ManualRoute.is_active == 1, ManualRoute.route_date == d
        )
        if wh:
            q_man = q_man.filter(ManualRoute.warehouse_name == wh)
        man_rows = q_man.all()
        man_st: Set[str] = set()
        for row in man_rows:
            for store in normalize_stores(row.stores or ""):
                man_st.add(store)

        series.append(
            {
                "route_date": d.isoformat(),
                "system_waybill_count": len(sys_rows),
                "manual_waybill_count": len(man_rows),
                "system_store_count": len(sys_st),
                "manual_store_count": len(man_st),
            }
        )
    return series


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


def _waybill_vehicle_label(vehicle_type: Optional[str]) -> str:
    s = (vehicle_type or "").strip()
    return s if s else "（未填）"


def _by_vehicle_type_store_breakdown(
    items: List[Dict[str, Any]], dataset_type: str
) -> List[Dict[str, Any]]:
    """
    按车型（选「全部」时再多一层 dataset_type）统计：
    各「配载门店数」档位的运单命中数、以及该车型在时间范围内的单均配载店数。
    """
    if not items:
        return []
    group_map: Dict[Tuple[Any, ...], List[Dict[str, Any]]] = {}
    for x in items:
        vt = x["vehicle_type"]
        if dataset_type == "all":
            key = (x["dataset_type"], vt)
        else:
            key = (vt,)
        group_map.setdefault(key, []).append(x)

    def _sort_key(k: Tuple[Any, ...]) -> Tuple:
        if len(k) == 2:
            side_order = 0 if k[0] == "system" else 1
            return (side_order, str(k[1]))
        return (0, str(k[0]))

    out: List[Dict[str, Any]] = []
    for key in sorted(group_map.keys(), key=_sort_key):
        rows = group_map[key]
        dist: Dict[str, int] = defaultdict(int)
        for r in rows:
            sc = int(r["store_count"])
            if sc < 0:
                sc = 0
            dist[str(sc)] = dist.get(str(sc), 0) + 1
        wcount = len(rows)
        total_sc = sum(int(x["store_count"]) for x in rows)
        avg = round((total_sc / wcount), 2) if wcount else 0.0
        dist_sorted = {d: dist[d] for d in sorted(dist.keys(), key=int)}
        row: Dict[str, Any] = {
            "vehicle_type": key[-1] if key else "（未填）",
            "waybill_count": wcount,
            "avg_store_count": avg,
            "store_count_distribution": dist_sorted,
        }
        if dataset_type == "all":
            row["dataset_type"] = key[0]
        out.append(row)
    return out


def waybill_store_load(
    db: Session,
    route_date_from: date,
    route_date_to: date,
    dataset_type: str,
    warehouse_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    在日期区间 + 仓库下，按运单行统计「拼载门店」去重个数（与 normalize_stores 一致），
    并给出单均配载门店数。随 dataset_type 只含对应侧运单；all 时两侧都列并带 dataset_type。
    """
    if dataset_type not in {"all", "system", "manual"}:
        raise ValueError("dataset_type must be all | system | manual")
    wh = (warehouse_name or "").strip() or None
    items: List[Dict[str, Any]] = []
    for d in _date_range_inclusive(route_date_from, route_date_to):
        if dataset_type in ("all", "system"):
            for r in _query_sys_suggest_for_day(db, d, wh).all():
                wb = (r.waybill_no or "").strip()
                if not wb:
                    continue
                n = len(normalize_stores(r.stores or ""))
                items.append(
                    {
                        "route_date": d.isoformat(),
                        "waybill_no": wb,
                        "dataset_type": "system",
                        "vehicle_type": _waybill_vehicle_label(
                            getattr(r, "vehicle_type", None)
                        ),
                        "store_count": n,
                    }
                )
        if dataset_type in ("all", "manual"):
            for r in _query_manual_route_for_day(db, d, wh).all():
                wb = (r.waybill_no or "").strip()
                if not wb:
                    continue
                n = len(normalize_stores(r.stores or ""))
                items.append(
                    {
                        "route_date": d.isoformat(),
                        "waybill_no": wb,
                        "dataset_type": "manual",
                        "vehicle_type": _waybill_vehicle_label(
                            getattr(r, "vehicle_type", None)
                        ),
                        "store_count": n,
                    }
                )
    items.sort(
        key=lambda x: (x["route_date"], x["dataset_type"], x["waybill_no"])
    )

    def _avg(rows: List[Dict[str, Any]]) -> float:
        if not rows:
            return 0.0
        return round(sum(x["store_count"] for x in rows) / len(rows), 2)

    sys_rows = [x for x in items if x["dataset_type"] == "system"]
    man_rows = [x for x in items if x["dataset_type"] == "manual"]
    summary = {
        "waybill_count": len(items),
        "avg_store_count": _avg(items),
        "system_waybill_count": len(sys_rows),
        "system_avg_store_count": _avg(sys_rows),
        "manual_waybill_count": len(man_rows),
        "manual_avg_store_count": _avg(man_rows),
    }
    by_vt = _by_vehicle_type_store_breakdown(items, dataset_type)
    return {
        "summary": summary,
        "by_vehicle_type": by_vt,
        "items": items,
    }


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
    store_diff = store_diff_summary(db, route_date_from, route_date_to, wh)
    vehicle_store_trend_by_day = _vehicle_store_trend_by_day(
        db, route_date_from, route_date_to, wh
    )
    wb_load = waybill_store_load(
        db, route_date_from, route_date_to, dataset_type, wh
    )
    return {
        "items": all_items,
        "trend_by_day": trend_by_day,
        "vehicle_store_trend_by_day": vehicle_store_trend_by_day,
        "waybill_store_load": wb_load,
        "warehouse_options": warehouse_options,
        "vehicle_diff": vehicle_diff,
        "store_diff": store_diff,
    }
