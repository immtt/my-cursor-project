from datetime import date
from pydantic import BaseModel


class CompareRequest(BaseModel):
    route_date: date
    match_threshold: float = 0.5


class ExportRequest(BaseModel):
    route_date: date
