import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

backend_root = Path(__file__).resolve().parents[2]
_backend_root = backend_root  # 兼容旧引用
_env_file = _backend_root / ".env"
if _env_file.is_file():
    load_dotenv(_env_file)


def _default_database_url() -> str:
    """优先读环境变量（含 backend/.env），便于本机 MySQL / SQLite 与 DataGrip 一致。"""
    return os.getenv("DATABASE_URL", "sqlite:///./smart_route.db")


def _default_gaode_mock() -> bool:
    """未配置 AMAP_KEY 时默认走模拟；配置 Key 后默认走真实高德，除非 GAODE_MOCK_ENABLED=true。"""
    if (os.getenv("AMAP_KEY") or "").strip():
        return os.getenv("GAODE_MOCK_ENABLED", "false").lower() in ("1", "true", "yes")
    return os.getenv("GAODE_MOCK_ENABLED", "true").lower() in ("1", "true", "yes")


class Settings(BaseModel):
    app_name: str = "Smart Route Compare API"
    database_url: str = Field(default_factory=_default_database_url)
    gaode_mock_enabled: bool = Field(default_factory=_default_gaode_mock)
    amap_key: str = Field(default_factory=lambda: (os.getenv("AMAP_KEY") or "").strip())
    amap_security_key: str = Field(
        default_factory=lambda: (os.getenv("AMAP_SECURITY_KEY") or "").strip()
    )


settings = Settings()


def amap_rest_enabled() -> bool:
    """手动补算等是否调用高德 REST（需 Key 且未强制模拟）。"""
    return bool(settings.amap_key) and not settings.gaode_mock_enabled
