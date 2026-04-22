from datetime import date
from pydantic import BaseModel


class ImportResult(BaseModel):
    total_rows: int
    success_rows: int
    failed_rows: int
    errors: list[dict]


class CompareOverview(BaseModel):
    route_date: date
    total: int
    full_count: int
    partial_count: int
    none_count: int
    avg_volume_diff: float | None
    avg_distance_diff: float | None
    avg_duration_diff: float | None


class CompareDetail(BaseModel):
    sys_waybill_no: str | None
    manual_waybill_no: str | None
    match_status: str
    store_match_rate: float
    volume_diff_rate: float | None
    line_consistent: bool
    est_distance_diff: float | None
    est_duration_diff: int | None
