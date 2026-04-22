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


def _is_duplicate_column_error(exc: OperationalError) -> bool:
    msg = str(exc).lower()
    if "duplicate" in msg or "already exists" in msg:
        return True
    orig = getattr(exc, "orig", None)
    args = getattr(orig, "args", None) if orig is not None else None
    if args and args[0] == 1060:
        return True
    return False


def ensure_sqlite_schema() -> None:
    """`create_all` 不会给已有表补列；对 SQLite / MySQL 旧库尝试 ADD COLUMN（列已存在则跳过）。"""
    alters = [
        ("manual_route", "vehicle_type", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("sys_suggest", "vehicle_type", "VARCHAR(100) NOT NULL DEFAULT ''"),
        ("manual_route", "delivery_store_order", "TEXT NULL"),
        ("customer_profile", "customer_short_name", "VARCHAR(200) NULL"),
        ("customer_profile", "customer_category", "VARCHAR(200) NULL"),
        ("customer_profile", "sales_org", "VARCHAR(200) NULL"),
        ("customer_profile", "addr_street", "VARCHAR(200) NULL"),
        ("customer_profile", "settlement_unit", "VARCHAR(200) NULL"),
        ("customer_profile", "status", "VARCHAR(100) NULL"),
        ("customer_profile", "created_by", "VARCHAR(64) NULL"),
        ("customer_profile", "updated_by", "VARCHAR(64) NULL"),
    ]
    with engine.begin() as conn:
        for table, col, ddl in alters:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            except OperationalError as e:
                if not _is_duplicate_column_error(e):
                    raise


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
