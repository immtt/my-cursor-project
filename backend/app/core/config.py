import os

from pydantic import BaseModel, Field


def _default_database_url() -> str:
    """优先读环境变量，便于本地换库、图形工具连同一文件。"""
    return os.getenv("DATABASE_URL", "sqlite:///./smart_route.db")


class Settings(BaseModel):
    app_name: str = "Smart Route Compare API"
    database_url: str = Field(default_factory=_default_database_url)
    gaode_mock_enabled: bool = Field(
        default_factory=lambda: os.getenv("GAODE_MOCK_ENABLED", "true").lower() in ("1", "true", "yes")
    )


settings = Settings()
