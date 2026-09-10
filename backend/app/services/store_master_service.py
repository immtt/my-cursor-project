"""门店坐标、仓店距离：列表与 CRUD。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.entities import StoreCoordinate, StorePairDistance
from app.utils.finite import json_safe_float, require_lng_lat


def _paginate(
    q, skip: int, limit: int
) -> Tuple[List[Any], int]:
    total = q.count()
    rows = q.offset(skip).limit(limit).all()
    return rows, total


def store_coordinate_to_item(r: StoreCoordinate) -> Dict[str, Any]:
    return {
        "id": r.id,
        "store_name": r.store_name,
        "longitude": json_safe_float(r.longitude),
        "latitude": json_safe_float(r.latitude),
        "data_source": r.data_source,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def list_store_coordinates(
    db: Session, *, skip: int = 0, limit: int = 50, search: Optional[str] = None
) -> Dict[str, Any]:
    q = db.query(StoreCoordinate).order_by(StoreCoordinate.id.desc())
    s = (search or "").strip()
    if s:
        like = f"%{s}%"
        q = q.filter(StoreCoordinate.store_name.like(like))
    rows, total = _paginate(q, max(0, skip), min(500, max(1, limit)))
    return {
        "items": [store_coordinate_to_item(r) for r in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


def get_store_coordinate(db: Session, row_id: int) -> Optional[StoreCoordinate]:
    return db.query(StoreCoordinate).filter(StoreCoordinate.id == row_id).first()


def create_store_coordinate(
    db: Session,
    *,
    store_name: str,
    longitude: float,
    latitude: float,
    data_source: Optional[str] = None,
) -> StoreCoordinate:
    name = (store_name or "").strip()
    if not name:
        raise ValueError("store_name 不能为空")
    longitude, latitude = require_lng_lat(longitude, latitude)
    exists = (
        db.query(StoreCoordinate).filter(StoreCoordinate.store_name == name).first()
    )
    if exists:
        raise ValueError(f"门店名称已存在: {name}")
    row = StoreCoordinate(
        store_name=name,
        longitude=longitude,
        latitude=latitude,
        data_source=(data_source or "").strip() or None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_store_coordinate(
    db: Session,
    row_id: int,
    *,
    store_name: Optional[str] = None,
    longitude: Optional[float] = None,
    latitude: Optional[float] = None,
    data_source: Optional[str] = None,
) -> StoreCoordinate:
    row = get_store_coordinate(db, row_id)
    if not row:
        raise ValueError("NOT_FOUND")
    if store_name is not None:
        n = store_name.strip()
        if not n:
            raise ValueError("store_name 不能为空")
        o = (
            db.query(StoreCoordinate)
            .filter(StoreCoordinate.store_name == n, StoreCoordinate.id != row_id)
            .first()
        )
        if o:
            raise ValueError(f"门店名称已存在: {n}")
        row.store_name = n
    if longitude is not None or latitude is not None:
        new_lng = row.longitude if longitude is None else longitude
        new_lat = row.latitude if latitude is None else latitude
        row.longitude, row.latitude = require_lng_lat(new_lng, new_lat)
    if data_source is not None:
        row.data_source = data_source.strip() or None
    db.commit()
    db.refresh(row)
    return row


def upsert_store_coordinate(
    db: Session,
    *,
    store_name: str,
    longitude: float,
    latitude: float,
    data_source: Optional[str] = None,
    commit: bool = True,
) -> tuple[StoreCoordinate, str]:
    """按门店名称更新或新增经纬度。返回 (行, "updated"|"inserted")。"""
    name = (store_name or "").strip()
    if not name:
        raise ValueError("store_name 不能为空")
    longitude, latitude = require_lng_lat(longitude, latitude)
    row = (
        db.query(StoreCoordinate)
        .filter(StoreCoordinate.store_name == name)
        .first()
    )
    if row:
        row.longitude = longitude
        row.latitude = latitude
        if data_source is not None:
            row.data_source = data_source.strip() or None
        if commit:
            db.commit()
            db.refresh(row)
        else:
            db.flush()
        return (row, "updated")
    r = StoreCoordinate(
        store_name=name,
        longitude=longitude,
        latitude=latitude,
        data_source=(data_source or "").strip() or None,
    )
    db.add(r)
    if commit:
        db.commit()
        db.refresh(r)
    else:
        db.flush()
    return (r, "inserted")


def delete_store_coordinate(db: Session, row_id: int) -> bool:
    row = get_store_coordinate(db, row_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def list_store_pair_distances(
    db: Session, *, skip: int = 0, limit: int = 50, search: Optional[str] = None
) -> Dict[str, Any]:
    q = db.query(StorePairDistance).order_by(StorePairDistance.id.desc())
    s = (search or "").strip()
    if s:
        like = f"%{s}%"
        q = q.filter(
            or_(
                StorePairDistance.store_from.like(like),
                StorePairDistance.store_to.like(like),
            )
        )
    rows, total = _paginate(q, max(0, skip), min(500, max(1, limit)))
    return {
        "items": [
            {
                "id": r.id,
                "store_from": r.store_from,
                "store_to": r.store_to,
                "distance_km": r.distance_km,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


def get_store_pair_distance(db: Session, row_id: int) -> Optional[StorePairDistance]:
    return (
        db.query(StorePairDistance).filter(StorePairDistance.id == row_id).first()
    )


def create_store_pair_distance(
    db: Session, *, store_from: str, store_to: str, distance_km: float
) -> StorePairDistance:
    sf = (store_from or "").strip()
    st = (store_to or "").strip()
    if not sf or not st:
        raise ValueError("store_from / store_to 不能为空")
    if sf == st:
        raise ValueError("起点与终点不能相同")
    ex = (
        db.query(StorePairDistance)
        .filter(StorePairDistance.store_from == sf, StorePairDistance.store_to == st)
        .first()
    )
    if ex:
        raise ValueError("该有向边已存在")
    row = StorePairDistance(
        store_from=sf, store_to=st, distance_km=distance_km
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_store_pair_distance(
    db: Session,
    row_id: int,
    *,
    store_from: Optional[str] = None,
    store_to: Optional[str] = None,
    distance_km: Optional[float] = None,
) -> StorePairDistance:
    row = get_store_pair_distance(db, row_id)
    if not row:
        raise ValueError("NOT_FOUND")
    if store_from is not None:
        sf = store_from.strip()
        if not sf:
            raise ValueError("store_from 不能为空")
        row.store_from = sf
    if store_to is not None:
        st = store_to.strip()
        if not st:
            raise ValueError("store_to 不能为空")
        row.store_to = st
    if row.store_from == row.store_to:
        raise ValueError("起点与终点不能相同")
    if store_from is not None or store_to is not None:
        o = (
            db.query(StorePairDistance)
            .filter(
                StorePairDistance.store_from == row.store_from,
                StorePairDistance.store_to == row.store_to,
                StorePairDistance.id != row_id,
            )
            .first()
        )
        if o:
            raise ValueError("该有向边已存在")
    if distance_km is not None:
        row.distance_km = distance_km
    db.commit()
    db.refresh(row)
    return row


def delete_store_pair_distance(db: Session, row_id: int) -> bool:
    row = get_store_pair_distance(db, row_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
