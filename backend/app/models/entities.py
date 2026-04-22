from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.db.session import Base


class SysSuggest(Base):
    __tablename__ = "sys_suggest"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    route_date = Column(Date, index=True, nullable=False, comment="排线日期")
    waybill_no = Column(String(50), nullable=False, comment="运单号")
    route_line = Column(String(100), nullable=False, comment="归属线路")
    warehouse_name = Column(String(200), nullable=False, comment="始发仓库")
    stores = Column(Text, nullable=False, comment="拼载门店（逗号分隔）")
    vehicle_type = Column(String(100), nullable=False, default="", comment="车辆类型")
    volume = Column(Float, nullable=False, comment="配送体积(m³)")
    load_rate = Column(Float, nullable=False, comment="装载率(%)")
    est_distance = Column(Float, nullable=False, comment="预计里程，单位：千米(km)")
    est_duration = Column(Integer, nullable=False, comment="预计时效，单位：分钟")
    route_polyline = Column(Text, nullable=True, comment="道路级轨迹折线 JSON（可选）")
    batch_id = Column(String(64), nullable=False, default="", comment="导入批次 ID")
    is_active = Column(Integer, nullable=False, default=1, index=True, comment="是否当前有效（1=有效，覆盖导入时旧批次为 0）")
    import_operator = Column(String(64), nullable=True, comment="导入操作人")
    imported_at = Column(DateTime, nullable=True, comment="导入时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")


class ManualRoute(Base):
    __tablename__ = "manual_route"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    route_date = Column(Date, index=True, nullable=False, comment="排线日期")
    waybill_no = Column(String(50), nullable=False, comment="运单号")
    route_line = Column(String(100), nullable=False, comment="归属线路")
    warehouse_name = Column(String(200), nullable=False, comment="始发仓库")
    stores = Column(Text, nullable=False, comment="拼载门店（逗号分隔）")
    vehicle_type = Column(String(100), nullable=False, default="", comment="车辆类型")
    volume = Column(Float, nullable=False, comment="配送体积(m³)")
    load_rate = Column(Float, nullable=False, comment="装载率(%)")
    est_distance = Column(Float, nullable=True, comment="补算或导入后的里程，单位：千米(km)")
    est_duration = Column(Integer, nullable=True, comment="补算或导入后的时效，单位：分钟")
    route_polyline = Column(Text, nullable=True, comment="道路级轨迹折线 JSON（补算成功时写入）")
    delivery_store_order = Column(Text, nullable=True, comment="配送途经门店顺序 JSON（补算成功时写入）")
    calc_status = Column(Integer, default=0, nullable=False, comment="补算状态：0 未成功/待算，1 成功，2 失败")
    batch_id = Column(String(64), nullable=False, default="", comment="导入批次 ID")
    is_active = Column(Integer, nullable=False, default=1, index=True, comment="是否当前有效（1=有效）")
    import_operator = Column(String(64), nullable=True, comment="导入操作人")
    imported_at = Column(DateTime, nullable=True, comment="导入时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, onupdate=func.now(), comment="更新时间")


class AddressCache(Base):
    __tablename__ = "address_cache"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    address_name = Column(String(200), unique=True, nullable=False, comment="地址名称（仓库或门店名，唯一）")
    address_type = Column(String(20), nullable=False, comment="类型：warehouse / store")
    longitude = Column(Float, nullable=False, comment="经度")
    latitude = Column(Float, nullable=False, comment="纬度")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")


class StoreCoordinate(Base):
    """门店经纬度（如仓店距离表导入）；与 address_cache 并存，门店解析优先读此表。"""

    __tablename__ = "store_coordinate"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    store_name = Column(
        String(300),
        unique=True,
        nullable=False,
        index=True,
        comment="门店名称（唯一，与排线拼载门店一致）",
    )
    longitude = Column(Float, nullable=False, comment="经度（与坐标数据源一致）")
    latitude = Column(Float, nullable=False, comment="纬度（与坐标数据源一致）")
    data_source = Column(String(120), nullable=True, comment="坐标数据来源说明（如导入文件名）")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, onupdate=func.now(), comment="更新时间")


class StorePairDistance(Base):
    """仓店距离（有向边：store_from → store_to）。"""

    __tablename__ = "store_pair_distance"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    store_from = Column(String(300), nullable=False, comment="起点门店（有向）")
    store_to = Column(String(300), nullable=False, comment="终点门店（有向）")
    distance_km = Column(Float, nullable=False, comment="仓店距离（千米）")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")

    __table_args__ = (UniqueConstraint("store_from", "store_to", name="uq_store_pair_from_to"),)


class CompareResult(Base):
    __tablename__ = "compare_result"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    route_date = Column(Date, index=True, nullable=False, comment="排线日期")
    sys_id = Column(Integer, ForeignKey("sys_suggest.id"), nullable=True, comment="系统建议行 ID（未匹配系统侧可为空）")
    manual_id = Column(Integer, ForeignKey("manual_route.id"), nullable=True, comment="手动排线行 ID（未匹配手工侧可为空）")
    match_status = Column(String(20), nullable=False, comment="匹配状态：full 完全 / partial 部分 / none 未匹配")
    store_match_rate = Column(Float, nullable=False, comment="门店匹配率（百分比展示值，如 33.33）")
    match_score = Column(Float, nullable=False, default=0, comment="门店匹配度（0～1 小数，与 PRD 公式一致）")
    volume_diff = Column(Float, nullable=True, comment="体积差异（m³，系统−手工）")
    line_consistent = Column(Integer, default=0, nullable=False, comment="线路是否一致（1=是，0=否）")
    est_distance_diff = Column(Float, nullable=True, comment="里程差（km，系统−手工）")
    est_duration_diff = Column(Integer, nullable=True, comment="时效差（分钟，系统−手工）")
    run_batch_id = Column(String(64), nullable=False, default="", comment="本次比对运行批次 ID")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")


class ImportAuditLog(Base):
    __tablename__ = "import_audit_log"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    batch_id = Column(String(64), nullable=False, index=True, comment="导入批次 ID")
    dataset_type = Column(String(16), nullable=False, comment="数据集类型：system / manual")
    route_date = Column(Date, nullable=False, index=True, comment="本批涉及的排线日期")
    operator = Column(String(64), nullable=True, comment="操作人")
    total_rows = Column(Integer, nullable=False, comment="总行数")
    success_rows = Column(Integer, nullable=False, comment="成功行数")
    failed_rows = Column(Integer, nullable=False, comment="失败行数")
    created_at = Column(DateTime, server_default=func.now(), comment="记录时间")


class CompareRunLog(Base):
    __tablename__ = "compare_run_log"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    run_batch_id = Column(String(64), nullable=False, index=True, comment="比对运行批次 ID")
    route_date = Column(Date, nullable=False, index=True, comment="排线日期")
    operator = Column(String(64), nullable=True, comment="操作人")
    duration_ms = Column(Integer, nullable=False, comment="耗时（毫秒）")
    result_count = Column(Integer, nullable=False, comment="写入的比对结果行数")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")


class GaodeCalcFailureLog(Base):
    __tablename__ = "gaode_calc_failure_log"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    manual_id = Column(Integer, ForeignKey("manual_route.id"), nullable=False, index=True, comment="手动排线行 ID")
    route_date = Column(Date, nullable=False, index=True, comment="排线日期")
    failed_store = Column(String(200), nullable=False, comment="失败关联门店或仓库名")
    reason = Column(String(500), nullable=False, comment="失败原因")
    retry_count = Column(Integer, nullable=False, default=0, comment="重试次数")
    last_retry_at = Column(DateTime, nullable=True, comment="最后重试时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")


class CustomerProfile(Base):
    """客户基础资料（与「客户列表」Excel 列一致，按客户代码 upsert）。"""

    __tablename__ = "customer_profile"

    id = Column(Integer, primary_key=True, index=True, comment="主键")
    customer_code = Column(String(64), unique=True, nullable=False, index=True, comment="客户代码")
    customer_name = Column(String(300), nullable=False, index=True, comment="客户名称")
    customer_type = Column(String(200), nullable=True, comment="客户类型")
    business_status = Column(String(200), nullable=True, comment="营业状态")
    contact_name = Column(String(200), nullable=True, comment="联系人")
    business_hours = Column(String(500), nullable=True, comment="营业时间")
    contact_phone = Column(String(200), nullable=True, comment="联系电话")
    province = Column(String(100), nullable=True, comment="省")
    city = Column(String(100), nullable=True, comment="市")
    district = Column(String(100), nullable=True, comment="区")
    county = Column(String(100), nullable=True, comment="县")
    address = Column(Text, nullable=True, comment="地址")
    performance_sla = Column(String(200), nullable=True, comment="履约时效")
    line_count = Column(String(64), nullable=True, comment="线路数")
    route_line = Column(String(500), nullable=True, comment="所属线路")
    e_sign = Column(String(200), nullable=True, comment="开启电子签")
    latest_delivery = Column(String(200), nullable=True, comment="最晚送达时间")
    auth_status = Column(String(200), nullable=True, comment="认证状态")
    settlement_warehouse_km = Column(Float, nullable=True, comment="结算仓店距离（km）")
    warehouse_store_km = Column(Float, nullable=True, comment="仓店距离（km）")
    customer_coordinate = Column(String(200), nullable=True, comment="客户坐标（原始）")
    driver_coordinate = Column(String(200), nullable=True, comment="司机上报坐标")
    carrier = Column(String(200), nullable=True, comment="所属承运商")
    staff_auth_detail = Column(Text, nullable=True, comment="员工认证明细")
    customer_group = Column(String(200), nullable=True, comment="所属客户组")
    group_min_order = Column(String(200), nullable=True, comment="客户组起送量")
    min_order_type = Column(String(200), nullable=True, comment="起送量类型")
    min_order = Column(String(200), nullable=True, comment="起送量")
    delivery_schedule = Column(String(200), nullable=True, comment="配送排程")
    loop_mode = Column(String(200), nullable=True, comment="循环模式")
    remark = Column(Text, nullable=True, comment="客户备注")
    consignee = Column(String(200), nullable=True, comment="收货人")
    delivery_coordinate = Column(String(200), nullable=True, comment="收货坐标（原始）")
    consignee_phone = Column(String(200), nullable=True, comment="收货电话")
    delivery_address = Column(Text, nullable=True, comment="收货地址")
    delivery_province = Column(String(100), nullable=True, comment="收货省")
    delivery_city = Column(String(100), nullable=True, comment="收货市")
    delivery_district = Column(String(100), nullable=True, comment="收货区")
    delivery_street = Column(String(200), nullable=True, comment="收货街道")
    import_source = Column(String(200), nullable=True, comment="最后写入来源（如导入文件名）")
    updated_at = Column(DateTime, onupdate=func.now(), comment="更新时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
