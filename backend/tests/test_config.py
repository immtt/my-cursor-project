from pathlib import Path

from app.core.config import DEFAULT_DATABASE_PATH, settings
from app.db.session import engine


def test_default_database_path_is_independent_of_working_directory():
    expected_path = Path(__file__).resolve().parents[1] / "smart_route.db"

    assert DEFAULT_DATABASE_PATH == expected_path
    assert Path(engine.url.database) == expected_path
    assert Path(engine.url.database).is_absolute()
