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


def ensure_warehouse_code_nullable() -> None:
    """旧库中 warehouse_code 为 NOT NULL 时，改为可空；新建库已由 ORM 创建为可空，无需处理。"""
    from sqlalchemy import inspect

    from app.models.entities import WarehouseBase

    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("warehouse_base"):
        return
    col_list = insp.get_columns("warehouse_base")
    col_info = {c["name"]: c for c in col_list}
    wc = col_info.get("warehouse_code")
    if not wc or wc.get("nullable") is True:
        return

    if engine.dialect.name in ("mysql", "mariadb"):
        with engine.begin() as conn:
            try:
                conn.execute(text("ALTER TABLE warehouse_base MODIFY warehouse_code VARCHAR(64) NULL"))
            except OperationalError:
                pass
        return

    if engine.dialect.name != "sqlite":
        return

    Sess = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    s = Sess()
    try:
        rows = s.query(WarehouseBase).all()
        state = [
            {c.key: getattr(r, c.key) for c in WarehouseBase.__table__.columns} for r in rows
        ]
    finally:
        s.close()
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE warehouse_base"))
    Base.metadata.create_all(bind=engine, tables=[WarehouseBase.__table__])
    s2 = Sess()
    try:
        for d in state:
            s2.add(WarehouseBase(**d))
        s2.commit()
    finally:
        s2.close()


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
        ("warehouse_base", "brand", "VARCHAR(500) NULL"),
    ]
    with engine.begin() as conn:
        for table, col, ddl in alters:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            except OperationalError as e:
                if not _is_duplicate_column_error(e):
                    raise
        try:
            conn.execute(
                text(
                    "UPDATE warehouse_base SET brand = secondary_org "
                    "WHERE (brand IS NULL OR TRIM(COALESCE(brand, '')) = '') "
                    "AND secondary_org IS NOT NULL AND TRIM(COALESCE(secondary_org, '')) != ''"
                )
            )
        except OperationalError:
            pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
