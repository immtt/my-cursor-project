from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field, model_validator


class CompareRequest(BaseModel):
    route_date_from: date
    route_date_to: date
    match_threshold: float = 0.5  # 保留字段；匹配状态按 PRD 分档，该值不再参与计算

    @model_validator(mode="after")
    def _date_range(self):
        if self.route_date_from > self.route_date_to:
            raise ValueError("route_date_from 不能晚于 route_date_to")
        return self


class ManualBackfillRequest(BaseModel):
    """补算二选一：`batch_id` 指定导入批次，或 `route_date_from`+`route_date_to` 指定排线日期区间（闭区间）。"""

    batch_id: Optional[str] = None
    route_date_from: Optional[date] = None
    route_date_to: Optional[date] = None

    @model_validator(mode="after")
    def _one_mode(self):
        bid = (self.batch_id or "").strip()
        has_batch = bool(bid)
        has_range = self.route_date_from is not None and self.route_date_to is not None
        if has_batch == has_range:
            raise ValueError("须且仅能填一种：batch_id，或 route_date_from 与 route_date_to")
        if has_range and self.route_date_from > self.route_date_to:
            raise ValueError("route_date_from 不能晚于 route_date_to")
        return self


class ExportRequest(BaseModel):
    route_date: date


class StoreCoordinateCreate(BaseModel):
    store_name: str
    longitude: float = Field(allow_inf_nan=False, ge=-180, le=180)
    latitude: float = Field(allow_inf_nan=False, ge=-90, le=90)
    data_source: Optional[str] = None


class StoreCoordinateUpdate(BaseModel):
    store_name: Optional[str] = None
    longitude: Optional[float] = Field(default=None, allow_inf_nan=False, ge=-180, le=180)
    latitude: Optional[float] = Field(default=None, allow_inf_nan=False, ge=-90, le=90)
    data_source: Optional[str] = None


class StorePairDistanceCreate(BaseModel):
    store_from: str
    store_to: str
    distance_km: float


class StorePairDistanceUpdate(BaseModel):
    store_from: Optional[str] = None
    store_to: Optional[str] = None
    distance_km: Optional[float] = None


class _CustomerProfileOptionalFields(BaseModel):
    customer_short_name: Optional[str] = None
    customer_category: Optional[str] = None
    sales_org: Optional[str] = None
    addr_street: Optional[str] = None
    settlement_unit: Optional[str] = None
    status: Optional[str] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    customer_type: Optional[str] = None
    business_status: Optional[str] = None
    contact_name: Optional[str] = None
    business_hours: Optional[str] = None
    contact_phone: Optional[str] = None
    province: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    county: Optional[str] = None
    address: Optional[str] = None
    performance_sla: Optional[str] = None
    line_count: Optional[str] = None
    route_line: Optional[str] = None
    e_sign: Optional[str] = None
    latest_delivery: Optional[str] = None
    auth_status: Optional[str] = None
    settlement_warehouse_km: Optional[float] = Field(default=None, allow_inf_nan=False)
    warehouse_store_km: Optional[float] = Field(default=None, allow_inf_nan=False)
    customer_coordinate: Optional[str] = None
    driver_coordinate: Optional[str] = None
    carrier: Optional[str] = None
    staff_auth_detail: Optional[str] = None
    customer_group: Optional[str] = None
    group_min_order: Optional[str] = None
    min_order_type: Optional[str] = None
    min_order: Optional[str] = None
    delivery_schedule: Optional[str] = None
    loop_mode: Optional[str] = None
    remark: Optional[str] = None
    consignee: Optional[str] = None
    delivery_coordinate: Optional[str] = None
    consignee_phone: Optional[str] = None
    delivery_address: Optional[str] = None
    delivery_province: Optional[str] = None
    delivery_city: Optional[str] = None
    delivery_district: Optional[str] = None
    delivery_street: Optional[str] = None
    import_source: Optional[str] = None


class CustomerProfileCreate(_CustomerProfileOptionalFields):
    customer_code: str
    customer_name: str


class CustomerProfileUpdate(_CustomerProfileOptionalFields):
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None


class BusinessBrandItem(BaseModel):
    """单条业务品牌（非系统侧栏品牌标识）；可填 LOGO 沿用说明，图示另走上传接口。"""

    name: str
    logo_as: Optional[str] = None


# 仓管理主数据：须含仓库名称、集团、仓库地址；业务品牌为业务数据用（与系统「品牌标识」页无关），见 business_brands 或 brand 汇总。
class _WarehouseBaseOptionalOnly(BaseModel):
    owning_org: Optional[str] = None
    logistics_org: Optional[str] = None
    dc_store_name: Optional[str] = None
    warehouse_category: Optional[str] = None
    temperature_layer: Optional[str] = None
    manager_name: Optional[str] = None
    manager_phone: Optional[str] = None
    coordinate_raw: Optional[str] = None
    status: Optional[str] = None
    warehouse_type: Optional[str] = None
    business_type: Optional[str] = None
    property_type: Optional[str] = None
    receiver_contact: Optional[str] = None
    receiver_phone: Optional[str] = None
    area_sqm: Optional[float] = Field(default=None, allow_inf_nan=False)
    coverage_region: Optional[str] = None
    zone_function: Optional[str] = None
    expected_store_count: Optional[float] = Field(default=None, allow_inf_nan=False)
    monthly_covered_stores: Optional[str] = None
    opening_date: Optional[str] = None
    sku_count_text: Optional[str] = None
    purchase_shared_flag: Optional[str] = None
    purchase_direct_flag: Optional[str] = None
    is_group_order_warehouse: Optional[str] = None
    remark: Optional[str] = None
    applicant: Optional[str] = None
    source_created_at: Optional[str] = None
    import_source: Optional[str] = None


class WarehouseBaseCreate(_WarehouseBaseOptionalOnly):
    warehouse_name: str
    group_name: str
    address: str
    brand: Optional[str] = None
    warehouse_code: Optional[str] = None
    business_brands: Optional[List[BusinessBrandItem]] = None


class WarehouseBaseUpdate(_WarehouseBaseOptionalOnly):
    warehouse_code: Optional[str] = None
    warehouse_name: Optional[str] = None
    group_name: Optional[str] = None
    address: Optional[str] = None
    brand: Optional[str] = None
    business_brands: Optional[List[BusinessBrandItem]] = None


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    username: str
    is_active: bool
    is_admin: bool
    created_at: Optional[datetime] = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserPublic


class AdminUserCreate(BaseModel):
    username: str
    password: str = Field(min_length=1)
    is_active: bool = True
    is_admin: bool = False


class AdminUserPatch(BaseModel):
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


class AdminResetPassword(BaseModel):
    new_password: str = Field(min_length=1)
