import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

_backend_root = Path(__file__).resolve().parents[2]
_env_file = _backend_root / ".env"
if _env_file.is_file():
    load_dotenv(_env_file)


def _default_database_url() -> str:
    """优先读环境变量（含 backend/.env），便于本机 MySQL / SQLite 与 DataGrip 一致。"""
    return os.getenv("DATABASE_URL", "sqlite:///./smart_route.db")


class Settings(BaseModel):
    app_name: str = "Smart Route Compare API"
    database_url: str = Field(default_factory=_default_database_url)
    gaode_mock_enabled: bool = Field(
        default_factory=lambda: os.getenv("GAODE_MOCK_ENABLED", "true").lower() in ("1", "true", "yes")
    )


settings = Settings()
