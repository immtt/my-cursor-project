from pathlib import Path

from pydantic import BaseModel


DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[2] / "smart_route.db"


class Settings(BaseModel):
    app_name: str = "Smart Route Compare API"
    database_url: str = f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"
    gaode_mock_enabled: bool = True


settings = Settings()
