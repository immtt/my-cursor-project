from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.db.session import Base


class SysSuggest(Base):
    __tablename__ = "sys_suggest"

    id = Column(Integer, primary_key=True, index=True)
    route_date = Column(Date, index=True, nullable=False)
    waybill_no = Column(String(50), nullable=False)
    route_line = Column(String(100), nullable=False)
    warehouse_name = Column(String(200), nullable=False)
    stores = Column(Text, nullable=False)
    vehicle_type = Column(String(100), nullable=False, default="")
    volume = Column(Float, nullable=False)
    load_rate = Column(Float, nullable=False)
    est_distance = Column(Float, nullable=False)
    est_duration = Column(Integer, nullable=False)
    route_polyline = Column(Text, nullable=True)
    batch_id = Column(String(64), nullable=False, default="")
    is_active = Column(Integer, nullable=False, default=1, index=True)
    import_operator = Column(String(64), nullable=True)
    imported_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class ManualRoute(Base):
    __tablename__ = "manual_route"

    id = Column(Integer, primary_key=True, index=True)
    route_date = Column(Date, index=True, nullable=False)
    waybill_no = Column(String(50), nullable=False)
    route_line = Column(String(100), nullable=False)
    warehouse_name = Column(String(200), nullable=False)
    stores = Column(Text, nullable=False)
    vehicle_type = Column(String(100), nullable=False, default="")
    volume = Column(Float, nullable=False)
    load_rate = Column(Float, nullable=False)
    est_distance = Column(Float, nullable=True)
    est_duration = Column(Integer, nullable=True)
    route_polyline = Column(Text, nullable=True)
    delivery_store_order = Column(Text, nullable=True)
    calc_status = Column(Integer, default=0, nullable=False)
    batch_id = Column(String(64), nullable=False, default="")
    is_active = Column(Integer, nullable=False, default=1, index=True)
    import_operator = Column(String(64), nullable=True)
    imported_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class AddressCache(Base):
    __tablename__ = "address_cache"

    id = Column(Integer, primary_key=True, index=True)
    address_name = Column(String(200), unique=True, nullable=False)
    address_type = Column(String(20), nullable=False)
    longitude = Column(Float, nullable=False)
    latitude = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class StoreCoordinate(Base):
    """门店经纬度（如店间距离表导入）；与 address_cache 并存，门店解析优先读此表。"""

    __tablename__ = "store_coordinate"

    id = Column(Integer, primary_key=True, index=True)
    store_name = Column(String(300), unique=True, nullable=False, index=True)
    longitude = Column(Float, nullable=False)
    latitude = Column(Float, nullable=False)
    data_source = Column(String(120), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class StorePairDistance(Base):
    """店间距离（有向边：store_from → store_to）。"""

    __tablename__ = "store_pair_distance"

    id = Column(Integer, primary_key=True, index=True)
    store_from = Column(String(300), nullable=False)
    store_to = Column(String(300), nullable=False)
    distance_km = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("store_from", "store_to", name="uq_store_pair_from_to"),)


class CompareResult(Base):
    __tablename__ = "compare_result"

    id = Column(Integer, primary_key=True, index=True)
    route_date = Column(Date, index=True, nullable=False)
    sys_id = Column(Integer, ForeignKey("sys_suggest.id"), nullable=True)
    manual_id = Column(Integer, ForeignKey("manual_route.id"), nullable=True)
    match_status = Column(String(20), nullable=False)
    store_match_rate = Column(Float, nullable=False)
    match_score = Column(Float, nullable=False, default=0)
    volume_diff = Column(Float, nullable=True)
    line_consistent = Column(Integer, default=0, nullable=False)
    est_distance_diff = Column(Float, nullable=True)
    est_duration_diff = Column(Integer, nullable=True)
    run_batch_id = Column(String(64), nullable=False, default="")
    created_at = Column(DateTime, server_default=func.now())


class ImportAuditLog(Base):
    __tablename__ = "import_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(64), nullable=False, index=True)
    dataset_type = Column(String(16), nullable=False)
    route_date = Column(Date, nullable=False, index=True)
    operator = Column(String(64), nullable=True)
    total_rows = Column(Integer, nullable=False)
    success_rows = Column(Integer, nullable=False)
    failed_rows = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class CompareRunLog(Base):
    __tablename__ = "compare_run_log"

    id = Column(Integer, primary_key=True, index=True)
    run_batch_id = Column(String(64), nullable=False, index=True)
    route_date = Column(Date, nullable=False, index=True)
    operator = Column(String(64), nullable=True)
    duration_ms = Column(Integer, nullable=False)
    result_count = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class GaodeCalcFailureLog(Base):
    __tablename__ = "gaode_calc_failure_log"

    id = Column(Integer, primary_key=True, index=True)
    manual_id = Column(Integer, ForeignKey("manual_route.id"), nullable=False, index=True)
    route_date = Column(Date, nullable=False, index=True)
    failed_store = Column(String(200), nullable=False)
    reason = Column(String(500), nullable=False)
    retry_count = Column(Integer, nullable=False, default=0)
    last_retry_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
