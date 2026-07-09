from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
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
    volume = Column(Float, nullable=False)
    load_rate = Column(Float, nullable=False)
    est_distance = Column(Float, nullable=True)
    est_duration = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class ManualRoute(Base):
    __tablename__ = "manual_route"

    id = Column(Integer, primary_key=True, index=True)
    route_date = Column(Date, index=True, nullable=False)
    waybill_no = Column(String(50), nullable=False)
    route_line = Column(String(100), nullable=False)
    warehouse_name = Column(String(200), nullable=False)
    stores = Column(Text, nullable=False)
    volume = Column(Float, nullable=False)
    load_rate = Column(Float, nullable=False)
    est_distance = Column(Float, nullable=True)
    est_duration = Column(Integer, nullable=True)
    calc_status = Column(Integer, default=0, nullable=False)
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


class CompareResult(Base):
    __tablename__ = "compare_result"

    id = Column(Integer, primary_key=True, index=True)
    route_date = Column(Date, index=True, nullable=False)
    sys_id = Column(Integer, ForeignKey("sys_suggest.id"), nullable=True)
    manual_id = Column(Integer, ForeignKey("manual_route.id"), nullable=True)
    match_status = Column(String(20), nullable=False)
    store_match_rate = Column(Float, nullable=False)
    volume_diff_rate = Column(Float, nullable=True)
    line_consistent = Column(Integer, default=0, nullable=False)
    est_distance_diff = Column(Float, nullable=True)
    est_duration_diff = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
