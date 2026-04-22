"""
去重 `sys_suggest` / `manual_route` 在 (排线日期, 运单号) 上的重复行，并建立业务唯一性。

规则：同键多行时保留 `imported_at` 较新，其次 `id` 较大者；外键重定向后删除余下行。
可安全多次执行（无重复时快速返回 0）。
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Tuple

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.entities import CompareResult, GaodeCalcFailureLog, ManualRoute, SysSuggest

logger = logging.getLogger(__name__)


def _pick_keeper_and_others(
    rows: list,
) -> Tuple[Any, list]:
    def sort_key(r: Any) -> Tuple[datetime, int]:
        t = r.imported_at
        if t is None:
            t = datetime.min
        return (t, r.id)

    srt = sorted(rows, key=sort_key, reverse=True)
    return srt[0], srt[1:]


def dedupe_sys_suggest(db: Session) -> int:
    removed = 0
    all_rows = db.query(SysSuggest).all()
    buckets: Dict[Tuple, list] = {}
    for r in all_rows:
        k = (r.route_date, (r.waybill_no or "").strip())
        buckets.setdefault(k, []).append(r)
    for k, group in buckets.items():
        if len(group) < 2:
            continue
        keeper, others = _pick_keeper_and_others(group)
        for dead in others:
            db.query(CompareResult).filter(CompareResult.sys_id == dead.id).update(
                {CompareResult.sys_id: keeper.id},
                synchronize_session=False,
            )
            db.delete(dead)
            removed += 1
    return removed


def dedupe_manual_route(db: Session) -> int:
    removed = 0
    all_rows = db.query(ManualRoute).all()
    buckets: Dict[Tuple, list] = {}
    for r in all_rows:
        k = (r.route_date, (r.waybill_no or "").strip())
        buckets.setdefault(k, []).append(r)
    for k, group in buckets.items():
        if len(group) < 2:
            continue
        keeper, others = _pick_keeper_and_others(group)
        for dead in others:
            db.query(CompareResult).filter(CompareResult.manual_id == dead.id).update(
                {CompareResult.manual_id: keeper.id},
                synchronize_session=False,
            )
            db.query(GaodeCalcFailureLog).filter(GaodeCalcFailureLog.manual_id == dead.id).update(
                {GaodeCalcFailureLog.manual_id: keeper.id},
                synchronize_session=False,
            )
            db.delete(dead)
            removed += 1
    return removed


def dedupe_compare_result(db: Session) -> int:
    """同 route_date + sys_id + manual_id 多行时保留 id 最小一条。"""
    removed = 0
    rows = db.query(CompareResult).order_by(CompareResult.id).all()
    seen: set = set()
    for r in rows:
        key = (r.route_date, r.sys_id, r.manual_id)
        if key in seen:
            db.delete(r)
            removed += 1
        else:
            seen.add(key)
    return removed


def apply_unique_indexes_route_waybill(engine) -> None:
    """在已无重复时创建 (route_date, waybill_no) 唯一约束；旧库无约束时补建同名唯一索引。"""
    INAME_SYS = "uq_sys_suggest_route_date_waybill"
    INAME_MAN = "uq_manual_route_route_date_waybill"
    insp = inspect(engine)
    dialect = engine.dialect.name
    for table, iname in (("sys_suggest", INAME_SYS), ("manual_route", INAME_MAN)):
        try:
            uqs = insp.get_unique_constraints(table) or []
        except Exception:
            uqs = []
        if any(u.get("name") == iname for u in uqs):
            continue
        try:
            idxs = insp.get_indexes(table) or []
        except Exception:
            idxs = []
        if any(i.get("name") == iname for i in idxs):
            continue
        ddl = f"CREATE UNIQUE INDEX {iname} ON {table} (route_date, waybill_no)"
        if dialect == "sqlite":
            ddl = f"CREATE UNIQUE INDEX IF NOT EXISTS {iname} ON {table} (route_date, waybill_no)"
        try:
            with engine.begin() as conn:
                conn.execute(text(ddl))
            logger.info("created unique index %s on %s", iname, table)
        except Exception as e:
            logger.warning("could not create unique index %s: %s", iname, e)


def dedupe_import_tables_and_apply_unique(engine) -> Dict[str, Any]:
    """
    1) 去重 sys_suggest / manual_route
    2) 去重 compare_result 业务键
    3) 创建唯一索引
    """
    session = SessionLocal()
    stats: Dict[str, Any] = {
        "sys_suggest_rows_removed": 0,
        "manual_route_rows_removed": 0,
        "compare_result_rows_removed": 0,
    }
    try:
        stats["sys_suggest_rows_removed"] = dedupe_sys_suggest(session)
        stats["manual_route_rows_removed"] = dedupe_manual_route(session)
        stats["compare_result_rows_removed"] = dedupe_compare_result(session)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    apply_unique_indexes_route_waybill(engine)
    return stats
