from datetime import date
from pydantic import BaseModel


class CompareRequest(BaseModel):
    route_date: date
    match_threshold: float = 0.5


class ManualBackfillRequest(BaseModel):
    batch_id: str


class ExportRequest(BaseModel):
    route_date: date
