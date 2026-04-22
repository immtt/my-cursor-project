from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Smart Route Compare API"
    database_url: str = "sqlite:///./smart_route.db"
    gaode_mock_enabled: bool = True


settings = Settings()
