"""差异分析：一店多车（单日、可单侧或系统+手合并）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Set, Tuple

from sqlalchemy.orm import Session

from app.models.entities import ManualRoute, SysSuggest
from app.utils.store_match import normalize_stores

_WbT = Tuple[str, str]  # (waybill_no, "system" | "manual")


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


def list_multi_vehicle_stores(
    db: Session,
    route_date: date,
    dataset_type: str,
) -> Dict[str, List[Dict[str, Any]]]:
    if dataset_type not in {"all", "system", "manual"}:
        raise ValueError("dataset_type must be all | system | manual")

    acc: dict[str, Set[_WbT]] = defaultdict(set)

    if dataset_type in {"all", "system"}:
        q_sys = db.query(SysSuggest).filter(
            SysSuggest.route_date == route_date, SysSuggest.is_active == 1
        )
        for row in q_sys.all():
            _scan_row(row.waybill_no, row.stores, "system", acc)
    if dataset_type in {"all", "manual"}:
        q_man = db.query(ManualRoute).filter(
            ManualRoute.route_date == route_date, ManualRoute.is_active == 1
        )
        for row in q_man.all():
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

    return {"items": items}
