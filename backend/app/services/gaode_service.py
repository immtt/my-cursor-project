from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.entities import AddressCache, GaodeCalcFailureLog, ManualRoute, SysSuggest


def _mock_geocode(address_name: str) -> tuple[float, float]:
    raw = hashlib.md5(address_name.encode("utf-8")).hexdigest()
    lng = 100 + (int(raw[:6], 16) % 3000) / 1000
    lat = 20 + (int(raw[6:12], 16) % 2000) / 1000
    return lng, lat


def get_or_create_coord(db: Session, address_name: str, address_type: str):
    if not address_name:
        raise ValueError("address is empty")
    cached = db.query(AddressCache).filter(AddressCache.address_name == address_name).first()
    if cached:
        return cached.longitude, cached.latitude
    lng, lat = _mock_geocode(address_name)
    db.add(AddressCache(address_name=address_name, address_type=address_type, longitude=lng, latitude=lat))
    db.commit()
    return lng, lat


def encode_route_polyline(path: List[List[float]]) -> str:
    return json.dumps({"path": path}, ensure_ascii=False)


def decode_route_polyline(raw: Optional[str]) -> Optional[List[List[float]]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and isinstance(data.get("path"), list):
            return data["path"]
    except (json.JSONDecodeError, TypeError):
        pass
    return None


def _interpolate_leg(p0: Tuple[float, float], p1: Tuple[float, float], steps: int = 8) -> List[List[float]]:
    """分段插值并略作侧向偏移，避免呈现为两点直线（开发环境模拟道路级折线）。"""
    lng0, lat0 = p0
    lng1, lat1 = p1
    dx, dy = lng1 - lng0, lat1 - lat0
    norm = math.sqrt(dx * dx + dy * dy) or 1.0
    px, py = -dy / norm * 0.012, dx / norm * 0.012
    out: List[List[float]] = []
    for i in range(steps + 1):
        t = i / steps
        w = math.sin(math.pi * t) * 0.35
        lng = lng0 + dx * t + px * w
        lat = lat0 + dy * t + py * w
        out.append([round(lng, 6), round(lat, 6)])
    return out


def estimate_route(
    warehouse: str, stores: List[str], db: Session
) -> Tuple[float, int, List[List[float]]]:
    nodes: List[Tuple[float, float]] = [get_or_create_coord(db, warehouse, "warehouse")]
    for store in stores:
        nodes.append(get_or_create_coord(db, store, "store"))
    total_dist = 0.0
    for i in range(len(nodes) - 1):
        lng_a, lat_a = nodes[i]
        lng_b, lat_b = nodes[i + 1]
        total_dist += abs(lng_b - lng_a) * 111 + abs(lat_b - lat_a) * 111
    path: List[List[float]] = []
    for i in range(len(nodes) - 1):
        seg = _interpolate_leg(nodes[i], nodes[i + 1])
        if path:
            path.extend(seg[1:])
        else:
            path.extend(seg)
    duration = int((total_dist / 35) * 60)
    return round(total_dist, 2), max(duration, 1), path


def _estimate_route_with_retry(warehouse: str, stores: List[str], db: Session, max_retry: int = 5):
    retry_count = 0
    while retry_count < max_retry:
        retry_count += 1
        try:
            return estimate_route(warehouse, stores, db), retry_count, None
        except Exception as exc:
            if retry_count >= max_retry:
                return None, retry_count, str(exc)
    return None, retry_count, "unknown"


def backfill_manual_routes(db: Session, route_date):
    rows = (
        db.query(ManualRoute)
        .filter(ManualRoute.route_date == route_date, ManualRoute.calc_status.in_([0, 2]), ManualRoute.is_active == 1)
        .all()
    )
    updated = 0
    failed = 0
    failures = []
    for row in rows:
        stores = [s.strip() for s in row.stores.split(",") if s.strip()]
        result, retry_count, err = _estimate_route_with_retry(row.warehouse_name, stores, db)
        if result:
            dist, dur, path = result
            row.est_distance = dist
            row.est_duration = dur
            row.route_polyline = encode_route_polyline(path)
            row.calc_status = 1
            updated += 1
        else:
            row.calc_status = 2
            failed += 1
            failed_store = stores[0] if stores else row.warehouse_name
            failures.append({"store": failed_store, "reason": err or "calc_failed", "retry_count": retry_count})
            db.add(
                GaodeCalcFailureLog(
                    manual_id=row.id,
                    route_date=row.route_date,
                    failed_store=failed_store,
                    reason=err or "calc_failed",
                    retry_count=retry_count,
                    last_retry_at=datetime.now(),
                )
            )
    db.commit()
    return {"updated": updated, "failed": failed, "failures": failures}


def build_markers(warehouse: str, stores_csv: str, db: Session) -> List[dict]:
    markers: List[dict] = []
    lng, lat = get_or_create_coord(db, warehouse, "warehouse")
    markers.append({"seq": 0, "name": warehouse, "lng": lng, "lat": lat, "kind": "warehouse"})
    stores = [s.strip() for s in stores_csv.split(",") if s.strip()]
    for i, name in enumerate(stores, start=1):
        slng, slat = get_or_create_coord(db, name, "store")
        markers.append({"seq": i, "name": name, "lng": slng, "lat": slat, "kind": "store"})
    return markers


def ensure_route_for_sys_suggest(db: Session, row: SysSuggest) -> Tuple[bool, Optional[List[List[float]]]]:
    stores = [s.strip() for s in row.stores.split(",") if s.strip()]
    if not row.warehouse_name or not stores:
        return False, None
    cached = decode_route_polyline(row.route_polyline)
    if cached:
        return True, cached
    try:
        _, _, path = estimate_route(row.warehouse_name, stores, db)
        row.route_polyline = encode_route_polyline(path)
        db.commit()
        return True, path
    except Exception:
        return False, None


def ensure_route_for_manual_row(db: Session, row: ManualRoute) -> Tuple[bool, Optional[List[List[float]]]]:
    if row.calc_status != 1:
        return False, None
    stores = [s.strip() for s in row.stores.split(",") if s.strip()]
    if not row.warehouse_name or not stores:
        return False, None
    cached = decode_route_polyline(row.route_polyline)
    if cached:
        return True, cached
    try:
        dist, dur, path = estimate_route(row.warehouse_name, stores, db)
        row.est_distance = dist
        row.est_duration = dur
        row.route_polyline = encode_route_polyline(path)
        db.commit()
        return True, path
    except Exception:
        return False, None
