from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ImportResult(BaseModel):
    total_rows: int
    success_rows: int
    failed_rows: int
    errors: List[Dict[str, Any]]


class CompareOverview(BaseModel):
    route_date: date
    total: int
    full_count: int
    partial_count: int
    none_count: int
    total_trip_diff: int
    total_volume_diff: float
    total_distance_diff: float
    total_duration_diff: int
    avg_volume_diff: Optional[float]
    avg_distance_diff: Optional[float]
    avg_duration_diff: Optional[float]


class CompareDetail(BaseModel):
    id: int
    sys_waybill_no: Optional[str]
    manual_waybill_no: Optional[str]
    sys_vehicle_type: Optional[str]
    manual_vehicle_type: Optional[str]
    match_status: str
    store_match_rate: float
    match_score: Optional[float]
    volume_diff: Optional[float]
    line_consistent: bool
    vehicle_type_consistent: Optional[bool]
    est_distance_diff: Optional[float]
    est_duration_diff: Optional[int]
