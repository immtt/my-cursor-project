from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Smart Route Compare API"
    database_url: str = "sqlite:///./smart_route.db"
    gaode_mock_enabled: bool = True
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]


settings = Settings()
