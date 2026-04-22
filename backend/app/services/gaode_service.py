from __future__ import annotations

import difflib
import hashlib
import json
import math
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from app.core.config import amap_rest_enabled, settings
from app.models.entities import AddressCache, GaodeCalcFailureLog, ManualRoute, StoreCoordinate, SysSuggest

_AMAP_BASE = "https://restapi.amap.com/v3"
_HTTPX_TIMEOUT = 20.0


def _mock_geocode(address_name: str) -> tuple[float, float]:
    raw = hashlib.md5(address_name.encode("utf-8")).hexdigest()
    lng = 100 + (int(raw[:6], 16) % 3000) / 1000
    lat = 20 + (int(raw[6:12], 16) % 2000) / 1000
    return lng, lat


def _list_store_coordinate_names(db: Session) -> List[str]:
    return [r[0] for r in db.query(StoreCoordinate.store_name).all()]


def _best_similar_store_name(db: Session, name: str, cutoff: float = 0.55) -> Optional[str]:
    if not name or not str(name).strip():
        return None
    candidates = _list_store_coordinate_names(db)
    if not candidates:
        return None
    matches = difflib.get_close_matches(name.strip(), candidates, n=1, cutoff=cutoff)
    return matches[0] if matches else None


def _row_lnglat_from_store_table(db: Session, store_name: str) -> Optional[Tuple[float, float]]:
    row = db.query(StoreCoordinate).filter(StoreCoordinate.store_name == store_name).first()
    if row:
        return row.longitude, row.latitude
    return None


def _amap_signed_params(extra: dict) -> dict:
    p = {k: v for k, v in extra.items() if v is not None and str(v) != ""}
    p["key"] = settings.amap_key
    sec = (settings.amap_security_key or "").strip()
    if not sec:
        return p
    pairs = sorted((str(k), str(v)) for k, v in p.items())
    raw = "&".join(f"{a}={b}" for a, b in pairs)
    raw += sec
    p["sig"] = hashlib.md5(raw.encode("utf-8")).hexdigest()
    return p


def _amap_get(path: str, params: dict) -> dict:
    q = _amap_signed_params(params)
    url = f"{_AMAP_BASE}/{path.lstrip('/')}"
    with httpx.Client(timeout=_HTTPPX_TIMEOUT) as client:
        r = client.get(url, params=q)
        r.raise_for_status()
        return r.json()


def _amap_geocode_lnglat(address: str) -> Optional[Tuple[float, float]]:
    if not (address or "").strip():
        return None
    data = _amap_get("geocode/geo", {"address": address.strip()})
    if str(data.get("status")) != "1":
        return None
    codes = data.get("geocodes") or []
    if not codes:
        return None
    loc = codes[0].get("location") or ""
    if "," not in loc:
        return None
    a, b = loc.split(",", 1)
    return float(a), float(b)


def _amap_place_text_lnglat(keywords: str) -> Optional[Tuple[float, float]]:
    if not (keywords or "").strip():
        return None
    data = _amap_get(
        "place/text",
        {"keywords": keywords.strip(), "offset": "1", "page": "1", "extensions": "base"},
    )
    if str(data.get("status")) != "1":
        return None
    pois = data.get("pois") or []
    if not pois:
        return None
    loc = pois[0].get("location") or ""
    if "," not in loc:
        return None
    a, b = loc.split(",", 1)
    return float(a), float(b)


def resolve_lnglat_for_manual(db: Session, label: str, *, kind: str) -> Tuple[float, float]:
    """手动补算用：门店表精确/相似名 → 缓存 → 高德（地理编码/关键词）→ 模拟。"""
    label = (label or "").strip()
    if not label:
        raise ValueError("address is empty")
    xy = _row_lnglat_from_store_table(db, label)
    if xy:
        return xy
    similar = _best_similar_store_name(db, label)
    if similar:
        xy2 = _row_lnglat_from_store_table(db, similar)
        if xy2:
            return xy2
    cached = db.query(AddressCache).filter(AddressCache.address_name == label).first()
    if cached:
        return cached.longitude, cached.latitude
    if amap_rest_enabled():
        try:
            if kind == "warehouse":
                ll = _amap_geocode_lnglat(label)
            else:
                ll = _amap_place_text_lnglat(label) or _amap_geocode_lnglat(label)
            if ll:
                db.add(
                    AddressCache(
                        address_name=label,
                        address_type=kind,
                        longitude=ll[0],
                        latitude=ll[1],
                    )
                )
                db.commit()
                return ll
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            db.rollback()
    lng, lat = _mock_geocode(label)
    db.add(AddressCache(address_name=label, address_type=kind, longitude=lng, latitude=lat))
    db.commit()
    return lng, lat


def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lng1, lat1, lng2, lat2 = a[0], a[1], b[0], b[1]
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def _nearest_neighbor_order(
    warehouse_xy: Tuple[float, float], store_names: List[str], coord_map: Dict[str, Tuple[float, float]]
) -> List[str]:
    remaining = [n for n in store_names if n in coord_map]
    if not remaining:
        return []
    order: List[str] = []
    cur = warehouse_xy
    while remaining:
        best = min(remaining, key=lambda n: _haversine_km(cur, coord_map[n]))
        order.append(best)
        remaining.remove(best)
        cur = coord_map[best]
    return order


def _parse_amap_step_points(steps: list) -> List[List[float]]:
    pts: List[List[float]] = []
    for st in steps or []:
        raw = st.get("polyline") or ""
        for part in raw.split(";"):
            part = part.strip()
            if not part or "," not in part:
                continue
            a, b = part.split(",", 1)
            try:
                pts.append([round(float(a), 6), round(float(b), 6)])
            except ValueError:
                continue
    return pts


def _amap_driving_leg(
    origin: Tuple[float, float], destination: Tuple[float, float]
) -> Tuple[float, float, List[List[float]]]:
    o = f"{origin[0]},{origin[1]}"
    d = f"{destination[0]},{destination[1]}"
    data = _amap_get("direction/driving", {"origin": o, "destination": d, "extensions": "all"})
    if str(data.get("status")) != "1":
        raise ValueError(data.get("info") or "amap direction failed")
    route = data.get("route") or {}
    paths = route.get("paths") or []
    if not paths:
        raise ValueError("amap no paths")
    p0 = paths[0]
    dist_m = float(p0.get("distance") or 0)
    dur_s = float(p0.get("duration") or 0)
    pts = _parse_amap_step_points(p0.get("steps") or [])
    return dist_m, dur_s, pts


def estimate_manual_route_amap(
    db: Session, warehouse: str, stores: List[str]
) -> Tuple[float, int, List[List[float]], List[str]]:
    """高德驾车路径串联；门店顺序为从仓出发的最近邻序。返回 (km, 分钟, 折线点, 门店顺序)。"""
    w_xy = resolve_lnglat_for_manual(db, warehouse, kind="warehouse")
    coord_map: Dict[str, Tuple[float, float]] = {}
    for s in stores:
        coord_map[s] = resolve_lnglat_for_manual(db, s, kind="store")
    visit_stores = _nearest_neighbor_order(w_xy, stores, coord_map)
    if not visit_stores:
        return 0.0, 0, [], []
    total_m = 0.0
    total_s = 0.0
    merged: List[List[float]] = []
    cur = w_xy
    for sn in visit_stores:
        nxt = coord_map[sn]
        dm, ds, leg_pts = _amap_driving_leg(cur, nxt)
        total_m += dm
        total_s += ds
        if leg_pts:
            if merged and leg_pts:
                if merged[-1] == leg_pts[0]:
                    merged.extend(leg_pts[1:])
                else:
                    merged.extend(leg_pts)
            else:
                merged.extend(leg_pts)
        cur = nxt
    dur_min = max(1, int(round(total_s / 60)))
    dist_km = round(total_m / 1000.0, 2)
    return dist_km, dur_min, merged, visit_stores


def estimate_bundle_for_manual(
    db: Session, warehouse: str, stores: List[str]
) -> Tuple[Tuple[float, int, List[List[float]]], List[str]]:
    if amap_rest_enabled():
        try:
            dist, dur, path, order = estimate_manual_route_amap(db, warehouse, stores)
            return (dist, dur, path), order
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            pass
    dist, dur, path = estimate_route(warehouse, stores, db)
    return (dist, dur, path), list(stores)


def get_or_create_coord(db: Session, address_name: str, address_type: str):
    if not address_name:
        raise ValueError("address is empty")
    if address_type == "store":
        sc = db.query(StoreCoordinate).filter(StoreCoordinate.store_name == address_name).first()
        if sc:
            return sc.longitude, sc.latitude
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


def _estimate_manual_bundle_with_retry(
    warehouse: str, stores: List[str], db: Session, max_retry: int = 5
):
    retry_count = 0
    while retry_count < max_retry:
        retry_count += 1
        try:
            bundle, order = estimate_bundle_for_manual(db, warehouse, stores)
            return (bundle, order), retry_count, None
        except Exception as exc:
            if retry_count >= max_retry:
                return None, retry_count, str(exc)
    return None, retry_count, "unknown"


def _run_manual_backfill_for_rows(db: Session, rows: List[ManualRoute]) -> dict:
    updated = 0
    failed = 0
    failures = []
    for row in rows:
        stores = [s.strip() for s in row.stores.split(",") if s.strip()]
        result, retry_count, err = _estimate_manual_bundle_with_retry(row.warehouse_name, stores, db)
        if result:
            (dist, dur, path), order = result
            row.est_distance = dist
            row.est_duration = dur
            row.route_polyline = encode_route_polyline(path)
            row.delivery_store_order = json.dumps(order, ensure_ascii=False)
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


def backfill_manual_routes(db: Session, route_date):
    rows = (
        db.query(ManualRoute)
        .filter(ManualRoute.route_date == route_date, ManualRoute.calc_status.in_([0, 2]), ManualRoute.is_active == 1)
        .all()
    )
    return _run_manual_backfill_for_rows(db, rows)


def backfill_manual_routes_by_batch(db: Session, batch_id: str) -> dict:
    """对指定导入批次下待补算的手动排线行做里程/时效估算（与比对前补算逻辑一致）。"""
    bid = str(batch_id).strip() if batch_id else ""
    if not bid:
        raise ValueError("batch_id required")
    rows = (
        db.query(ManualRoute)
        .filter(ManualRoute.batch_id == bid, ManualRoute.calc_status.in_([0, 2]), ManualRoute.is_active == 1)
        .all()
    )
    return _run_manual_backfill_for_rows(db, rows)


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
        (dist, dur, path), order = estimate_bundle_for_manual(db, row.warehouse_name, stores)
        row.est_distance = dist
        row.est_duration = dur
        row.route_polyline = encode_route_polyline(path)
        row.delivery_store_order = json.dumps(order, ensure_ascii=False)
        db.commit()
        return True, path
    except Exception:
        return False, None
