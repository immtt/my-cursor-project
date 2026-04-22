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
    avg_volume_diff: Optional[float]
    avg_distance_diff: Optional[float]
    avg_duration_diff: Optional[float]


class CompareDetail(BaseModel):
    id: int
    sys_waybill_no: Optional[str]
    manual_waybill_no: Optional[str]
    match_status: str
    store_match_rate: float
    match_score: Optional[float]
    volume_diff: Optional[float]
    line_consistent: bool
    est_distance_diff: Optional[float]
    est_duration_diff: Optional[int]
