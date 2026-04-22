from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

_connect_args = (
    {"check_same_thread": False}
    if str(settings.database_url).startswith("sqlite")
    else {}
)
engine = create_engine(settings.database_url, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


def ensure_sqlite_schema() -> None:
    """`create_all` 不会给已有表补列；旧版库缺 vehicle_type 时导入会 500。仅 SQLite 上补全。"""
    if not str(engine.url).startswith("sqlite"):
        return
    alters = [
        ("manual_route", "vehicle_type", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("sys_suggest", "vehicle_type", "VARCHAR(100) NOT NULL DEFAULT ''"),
    ]
    with engine.begin() as conn:
        for table, col, ddl in alters:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            except OperationalError as e:
                if "duplicate" not in str(e).lower():
                    raise


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
