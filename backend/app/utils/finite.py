"""Reject or sanitize non-finite floats so API JSON never emits Inf/NaN."""
from __future__ import annotations

import math
from typing import Any, Optional, Tuple


def parse_finite_or_none(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return v


def json_safe_float(value: Any) -> Optional[float]:
    return parse_finite_or_none(value)


def to_jsonable(obj: Any) -> Any:
    """Replace Inf/NaN so Starlette JSONResponse can serialize validation errors."""
    if isinstance(obj, float) and not math.isfinite(obj):
        return str(obj)
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    return obj


def require_finite(value: Any, *, field: str) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} 须为有限数值") from exc
    if not math.isfinite(v):
        raise ValueError(f"{field} 须为有限数值")
    return v


def require_lng_lat(longitude: Any, latitude: Any) -> Tuple[float, float]:
    lng = require_finite(longitude, field="经度")
    lat = require_finite(latitude, field="纬度")
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise ValueError("经纬度超出有效范围")
    return lng, lat
