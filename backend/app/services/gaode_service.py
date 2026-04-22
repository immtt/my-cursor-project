import hashlib

from sqlalchemy.orm import Session

from app.models.entities import AddressCache, ManualRoute


def _mock_geocode(address_name: str) -> tuple[float, float]:
    raw = hashlib.md5(address_name.encode("utf-8")).hexdigest()
    lng = 100 + (int(raw[:6], 16) % 3000) / 1000
    lat = 20 + (int(raw[6:12], 16) % 2000) / 1000
    return lng, lat


def get_or_create_coord(db: Session, address_name: str, address_type: str):
    cached = db.query(AddressCache).filter(AddressCache.address_name == address_name).first()
    if cached:
        return cached.longitude, cached.latitude
    lng, lat = _mock_geocode(address_name)
    db.add(AddressCache(address_name=address_name, address_type=address_type, longitude=lng, latitude=lat))
    db.commit()
    return lng, lat


def estimate_route(warehouse: str, stores: list[str], db: Session) -> tuple[float, int]:
    start_lng, start_lat = get_or_create_coord(db, warehouse, "warehouse")
    total_dist = 0.0
    current_lng, current_lat = start_lng, start_lat
    for store in stores:
        lng, lat = get_or_create_coord(db, store, "store")
        leg = abs(lng - current_lng) * 111 + abs(lat - current_lat) * 111
        total_dist += leg
        current_lng, current_lat = lng, lat
    duration = int((total_dist / 35) * 60)
    return round(total_dist, 2), max(duration, 1)


def backfill_manual_routes(db: Session, route_date):
    rows = (
        db.query(ManualRoute)
        .filter(ManualRoute.route_date == route_date, ManualRoute.calc_status.in_([0, 2]))
        .all()
    )
    updated = 0
    failed = 0
    for row in rows:
        try:
            stores = [s.strip() for s in row.stores.split(",") if s.strip()]
            dist, dur = estimate_route(row.warehouse_name, stores, db)
            row.est_distance = dist
            row.est_duration = dur
            row.calc_status = 1
            updated += 1
        except Exception:
            row.calc_status = 2
            failed += 1
    db.commit()
    return {"updated": updated, "failed": failed}
