"""仓店距离 Excel：与 scripts/import_store_distances.py 表头一致；供 API 导入/导出。"""
from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import Workbook, load_workbook
from sqlalchemy.orm import Session

from app.models.entities import StoreCoordinate, StorePairDistance

HEADER_C1 = "客户1"
HEADER_C1_COORD = "客户1坐标"
HEADER_C2 = "客户2"
HEADER_C2_COORD = "客户2坐标"
HEADER_DIST = "距离（km）"


def _norm_cell(v) -> str:
    if v is None:
        return ""
    return str(v).strip()


def parse_lng_lat(raw: str) -> Optional[Tuple[float, float]]:
    s = _norm_cell(raw)
    if not s:
        return None
    s = s.replace("，", ",")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if len(parts) < 2:
        m = re.match(r"^\s*([0-9.+-]+)\s+([0-9.+-]+)\s*$", s)
        if not m:
            return None
        parts = [m.group(1), m.group(2)]
    try:
        lng = float(parts[0])
        lat = float(parts[1])
    except ValueError:
        return None
    return lng, lat


def parse_distance_km(raw) -> Optional[float]:
    s = _norm_cell(raw)
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def upsert_store_coord(
    db: Session,
    name: str,
    lng: float,
    lat: float,
    data_source: str,
) -> None:
    row = db.query(StoreCoordinate).filter(StoreCoordinate.store_name == name).first()
    if row:
        row.longitude = lng
        row.latitude = lat
        row.data_source = data_source
    else:
        db.add(
            StoreCoordinate(
                store_name=name,
                longitude=lng,
                latitude=lat,
                data_source=data_source,
            )
        )
        db.flush()


def upsert_store_pair_distance(db: Session, store_from: str, store_to: str, distance_km: float) -> None:
    row = (
        db.query(StorePairDistance)
        .filter(StorePairDistance.store_from == store_from, StorePairDistance.store_to == store_to)
        .first()
    )
    if row:
        row.distance_km = distance_km
    else:
        db.add(
            StorePairDistance(
                store_from=store_from,
                store_to=store_to,
                distance_km=distance_km,
            )
        )


def import_workbook_path(db: Session, path: str, data_source_label: str) -> Dict[str, Any]:
    """从 xlsx 路径导入；按 sheet 提交，与 CLI 脚本行为一致。"""
    wb = load_workbook(path, read_only=True, data_only=True)
    stats = {"sheets": 0, "distance_rows": 0, "skipped_rows": 0}
    try:
        for sheet_name in wb.sheetnames:
            stats["sheets"] += 1
            ws = wb[sheet_name]
            rows_iter = ws.iter_rows(values_only=True)
            header = next(rows_iter, None)
            if not header:
                continue
            header = [_norm_cell(h) for h in header]
            try:
                i1 = header.index(HEADER_C1)
                i1c = header.index(HEADER_C1_COORD)
                i2 = header.index(HEADER_C2)
                i2c = header.index(HEADER_C2_COORD)
                idist = header.index(HEADER_DIST)
            except ValueError:
                continue

            for row in rows_iter:
                if not row:
                    continue

                def cell(idx: int):
                    return row[idx] if idx < len(row) else None

                n1 = _norm_cell(cell(i1))
                n2 = _norm_cell(cell(i2))
                coord1 = parse_lng_lat(cell(i1c) or "")
                coord2 = parse_lng_lat(cell(i2c) or "")
                dist = parse_distance_km(cell(idist))

                if not n1 or not n2 or coord1 is None or coord2 is None or dist is None:
                    stats["skipped_rows"] += 1
                    continue

                upsert_store_coord(db, n1, coord1[0], coord1[1], data_source_label)
                upsert_store_coord(db, n2, coord2[0], coord2[1], data_source_label)
                upsert_store_pair_distance(db, n1, n2, dist)
                stats["distance_rows"] += 1

            db.commit()
    finally:
        wb.close()
    return stats


def _coord_str(db: Session, name: str) -> str:
    r = db.query(StoreCoordinate).filter(StoreCoordinate.store_name == name).first()
    if not r:
        return ""
    return f"{r.longitude},{r.latitude}"


def build_export_xlsx_bytes(db: Session) -> bytes:
    """两表：仓店距离（可再导入格式）、门店坐标简表。"""
    wb = Workbook()
    # Sheet1: 与导入一致
    ws1 = wb.active
    ws1.title = "仓店距离"
    ws1.append(
        [HEADER_C1, HEADER_C1_COORD, HEADER_C2, HEADER_C2_COORD, HEADER_DIST]
    )
    pairs: List[StorePairDistance] = (
        db.query(StorePairDistance).order_by(StorePairDistance.id).all()
    )
    for p in pairs:
        c1 = _coord_str(db, p.store_from)
        c2 = _coord_str(db, p.store_to)
        ws1.append(
            [p.store_from, c1, p.store_to, c2, p.distance_km]
        )
    # Sheet2: 门店坐标
    ws2 = wb.create_sheet("门店坐标")
    ws2.append(["门店名称", "经度", "纬度", "数据来源"])
    coords: List[StoreCoordinate] = (
        db.query(StoreCoordinate).order_by(StoreCoordinate.id).all()
    )
    for c in coords:
        ws2.append([c.store_name, c.longitude, c.latitude, c.data_source or ""])

    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue()
