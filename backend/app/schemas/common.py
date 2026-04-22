from enum import Enum
from pydantic import BaseModel


class MatchStatus(str, Enum):
    full = "full"
    partial = "partial"
    none = "none"


class ErrorResponse(BaseModel):
    code: str
    message: str
