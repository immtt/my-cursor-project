import json
import re
import uuid
from datetime import date, datetime
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import Workbook, load_workbook
from sqlalchemy.orm import Session

from app.models.entities import ImportAuditLog, ManualRoute, SysSuggest


REQUIRED_COLUMNS = [
    "排线日期",
    "运单号",
    "归属线路",
    "始发仓库",
    "拼载门店",
    "车辆类型",
    "配送体积",
    "装载率",
]


def _parse_date(value):
    if hasattr(value, "date"):
        return value.date()
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _normalize_header_label(raw: str) -> str:
    """将「配送体积(m³)」「装载率(%)」等与必填列名对齐。"""
    s = raw.strip()
    s = re.sub(r"\s*[\(（][^)）]+[\)）]\s*$", "", s).strip()
    return s


def _append_template_instruction_sheet(wb: Workbook, dataset_type: str) -> None:
    """第二页「填写说明」：与导入校验一致，避免仅看表头遗漏「车辆类型」等必填项。"""
    ws = wb.create_sheet("填写说明", 1)
    rows = [
        "导入时请使用「导入数据」工作表；第一行为表头，第二行为示例，自第三行起填写业务数据。",
        "",
        "必填列顺序须与表头一致：",
        "排线日期、运单号、归属线路、始发仓库、拼载门店、车辆类型、配送体积、装载率。",
        "",
        "【车辆类型】必填。示例：4.2米标箱、4.2米高栏。系统建议与手工排线可填不同车型，便于比对。",
        "",
    ]
    if dataset_type == "system":
        rows.append(
            "【系统建议】还须填写：预计公里数(km)、预计时效(分钟)（整数分钟；暂无时可填 0）。"
        )
        rows.append("请勿将米、秒等填入：里程仅保存为千米，时效仅保存为分钟。")
    else:
        rows.append("【手动排线】无需填写预计公里数、预计时效，比对前由系统自动补算。")
    for i, text in enumerate(rows, start=1):
        ws.cell(row=i, column=1, value=text)


def build_import_template_xlsx(dataset_type: str) -> Tuple[bytes, str]:
    """生成与导入规则一致的标准 Excel 模板（含表头 + 一行示例 + 填写说明页）。"""
    if dataset_type not in {"system", "manual"}:
        raise ValueError("dataset_type must be system or manual")
    wb = Workbook()
    ws = wb.active
    ws.title = "导入数据"
    if dataset_type == "system":
        filename = "智能排线_导入模板_系统建议.xlsx"
        ws.append(
            [
                "排线日期",
                "运单号",
                "归属线路",
                "始发仓库",
                "拼载门店",
                "车辆类型",
                "配送体积",
                "装载率",
                "预计公里数(km)",
                "预计时效(分钟)",
            ]
        )
        ws.append(
            [
                date(2026, 4, 21),
                "示例运单001",
                "示例线路",
                "示例仓库",
                "示例门店甲,示例门店乙",
                "4.2米标箱",
                10.5,
                75,
                45.0,
                90,
            ]
        )
    else:
        filename = "智能排线_导入模板_手动排线.xlsx"
        ws.append(
            [
                "排线日期",
                "运单号",
                "归属线路",
                "始发仓库",
                "拼载门店",
                "车辆类型",
                "配送体积",
                "装载率",
            ]
        )
        ws.append(
            [
                date(2026, 4, 21),
                "示例运单001",
                "示例线路",
                "示例仓库",
                "示例门店甲,示例门店乙",
                "4.2米高栏",
                10.5,
                75,
            ]
        )
    _append_template_instruction_sheet(wb, dataset_type)
    bio = BytesIO()
    wb.save(bio)
    return bio.getvalue(), filename


def _build_header_map(sheet) -> Dict[str, int]:
    raw = [str(cell.value).strip() if cell.value else "" for cell in sheet[1]]
    header_map: Dict[str, int] = {}
    for idx, name in enumerate(raw):
        if not name:
            continue
        key = _normalize_header_label(name)
        if key not in header_map:
            header_map[key] = idx
    return header_map


def import_excel(db: Session, dataset_type: str, file_path: str, operator: str = "system"):
    wb = load_workbook(file_path)
    sheet = wb.active
    header_map = _build_header_map(sheet)
    headers = [str(cell.value).strip() if cell.value else "" for cell in sheet[1]]

    errors = []
    total_rows = 0
    success_rows = 0
    staged_records = []
    touched_dates = set()

    for col in REQUIRED_COLUMNS:
        if col not in header_map:
            errors.append({"row": 1, "reason": f"缺少必填列: {col}"})
    if errors:
        return {"total_rows": 0, "success_rows": 0, "failed_rows": 0, "errors": errors}

    for row_no in range(2, sheet.max_row + 1):
        total_rows += 1
        values = [sheet.cell(row=row_no, column=i + 1).value for i in range(len(headers))]
        try:
            route_date = _parse_date(values[header_map["排线日期"]])
            waybill_no = str(values[header_map["运单号"]]).strip()
            route_line = str(values[header_map["归属线路"]]).strip()
            warehouse_name = str(values[header_map["始发仓库"]]).strip()
            stores = str(values[header_map["拼载门店"]]).strip()
            vehicle_type = str(values[header_map["车辆类型"]]).strip()
            volume = float(values[header_map["配送体积"]])
            load_rate = float(str(values[header_map["装载率"]]).replace("%", ""))

            if not all([waybill_no, route_line, warehouse_name, stores, vehicle_type]):
                raise ValueError("文本字段存在空值（含车辆类型）")
            if volume < 0:
                raise ValueError("配送体积不能为负数")

            touched_dates.add(route_date)
            if dataset_type == "system":
                est_distance = float(values[header_map.get("预计公里数", -1)] or 0)
                est_duration = int(values[header_map.get("预计时效", -1)] or 0)
                staged_records.append(
                    SysSuggest(
                        route_date=route_date,
                        waybill_no=waybill_no,
                        route_line=route_line,
                        warehouse_name=warehouse_name,
                        stores=stores,
                        vehicle_type=vehicle_type,
                        volume=volume,
                        load_rate=load_rate,
                        est_distance=est_distance,
                        est_duration=est_duration,
                    )
                )
            else:
                staged_records.append(
                    ManualRoute(
                        route_date=route_date,
                        waybill_no=waybill_no,
                        route_line=route_line,
                        warehouse_name=warehouse_name,
                        stores=stores,
                        vehicle_type=vehicle_type,
                        volume=volume,
                        load_rate=load_rate,
                    )
                )
            success_rows += 1
        except Exception as exc:
            errors.append({"row": row_no, "reason": str(exc)})

    batch_id = uuid.uuid4().hex[:16]
    imported_at = datetime.now()

    for obj in staged_records:
        obj.batch_id = batch_id
        obj.is_active = 1
        obj.import_operator = operator
        obj.imported_at = imported_at
        if dataset_type == "system":
            existing = (
                db.query(SysSuggest)
                .filter(SysSuggest.route_date == obj.route_date, SysSuggest.waybill_no == obj.waybill_no)
                .first()
            )
            if existing:
                existing.route_line = obj.route_line
                existing.warehouse_name = obj.warehouse_name
                existing.stores = obj.stores
                existing.vehicle_type = obj.vehicle_type
                existing.volume = obj.volume
                existing.load_rate = obj.load_rate
                existing.est_distance = obj.est_distance
                existing.est_duration = obj.est_duration
                existing.batch_id = batch_id
                existing.import_operator = operator
                existing.imported_at = imported_at
                existing.is_active = 1
            else:
                db.add(obj)
        else:
            existing = (
                db.query(ManualRoute)
                .filter(ManualRoute.route_date == obj.route_date, ManualRoute.waybill_no == obj.waybill_no)
                .first()
            )
            if existing:
                existing.route_line = obj.route_line
                existing.warehouse_name = obj.warehouse_name
                existing.stores = obj.stores
                existing.vehicle_type = obj.vehicle_type
                existing.volume = obj.volume
                existing.load_rate = obj.load_rate
                existing.batch_id = batch_id
                existing.import_operator = operator
                existing.imported_at = imported_at
                existing.is_active = 1
                existing.calc_status = 0
                existing.est_distance = None
                existing.est_duration = None
                existing.route_polyline = None
                existing.delivery_store_order = None
            else:
                db.add(obj)

    for route_date in touched_dates:
        db.add(
            ImportAuditLog(
                batch_id=batch_id,
                dataset_type=dataset_type,
                route_date=route_date,
                operator=operator,
                total_rows=total_rows,
                success_rows=success_rows,
                failed_rows=total_rows - success_rows,
            )
        )

    db.commit()
    return {
        "batch_id": batch_id,
        "total_rows": total_rows,
        "success_rows": success_rows,
        "failed_rows": total_rows - success_rows,
        "errors": errors,
    }


def _suggest_row_dict(r: SysSuggest) -> Dict[str, Any]:
    return {
        "id": r.id,
        "route_date": r.route_date.isoformat() if r.route_date else None,
        "waybill_no": r.waybill_no,
        "route_line": r.route_line,
        "warehouse_name": r.warehouse_name,
        "stores": r.stores,
        "vehicle_type": r.vehicle_type,
        "volume": r.volume,
        "load_rate": r.load_rate,
        "est_distance": r.est_distance,
        "est_duration": r.est_duration,
    }


def _manual_row_dict(r: ManualRoute) -> Dict[str, Any]:
    order = None
    if r.delivery_store_order:
        try:
            order = json.loads(r.delivery_store_order)
        except (json.JSONDecodeError, TypeError):
            order = r.delivery_store_order
    return {
        "id": r.id,
        "route_date": r.route_date.isoformat() if r.route_date else None,
        "waybill_no": r.waybill_no,
        "route_line": r.route_line,
        "warehouse_name": r.warehouse_name,
        "stores": r.stores,
        "vehicle_type": r.vehicle_type,
        "volume": r.volume,
        "load_rate": r.load_rate,
        "est_distance": r.est_distance,
        "est_duration": r.est_duration,
        "delivery_store_order": order,
    }


def fetch_import_batch_rows(db: Session, dataset_type: str, batch_id: str) -> List[Dict[str, Any]]:
    """按导入返回的 batch_id 查询本批生效行（仅 is_active=1），全量。"""
    if dataset_type not in {"system", "manual"}:
        raise ValueError("dataset_type must be system or manual")
    if not batch_id or not str(batch_id).strip():
        raise ValueError("batch_id required")
    bid = str(batch_id).strip()
    if dataset_type == "system":
        rows = (
            db.query(SysSuggest)
            .filter(SysSuggest.batch_id == bid, SysSuggest.is_active == 1)
            .order_by(SysSuggest.id)
            .all()
        )
        return [_suggest_row_dict(r) for r in rows]
    rows = (
        db.query(ManualRoute)
        .filter(ManualRoute.batch_id == bid, ManualRoute.is_active == 1)
        .order_by(ManualRoute.id)
        .all()
    )
    return [_manual_row_dict(r) for r in rows]


def fetch_import_batch_page(
    db: Session, dataset_type: str, batch_id: str, page: int, page_size: int
) -> Dict[str, Any]:
    """分页查询本批生效行；page_size 仅允许 20 或 50。"""
    if page_size not in (20, 50):
        raise ValueError("page_size must be 20 or 50")
    if page < 1:
        raise ValueError("page must be >= 1")
    if dataset_type not in {"system", "manual"}:
        raise ValueError("dataset_type must be system or manual")
    if not batch_id or not str(batch_id).strip():
        raise ValueError("batch_id required")
    bid = str(batch_id).strip()
    offset = (page - 1) * page_size
    if dataset_type == "system":
        q = db.query(SysSuggest).filter(SysSuggest.batch_id == bid, SysSuggest.is_active == 1)
        total = q.count()
        rows = q.order_by(SysSuggest.id).offset(offset).limit(page_size).all()
        items = [_suggest_row_dict(r) for r in rows]
    else:
        q = db.query(ManualRoute).filter(ManualRoute.batch_id == bid, ManualRoute.is_active == 1)
        total = q.count()
        rows = q.order_by(ManualRoute.id).offset(offset).limit(page_size).all()
        items = [_manual_row_dict(r) for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def fetch_active_import_page(
    db: Session,
    dataset_type: str,
    route_date_from: date,
    route_date_to: date,
    page: int,
    page_size: int,
    warehouse_name: Optional[str] = None,
) -> Dict[str, Any]:
    """按排线日期闭区间分页查询当前有效行（is_active=1）；page_size 仅 20 或 50。"""
    if page_size not in (20, 50):
        raise ValueError("page_size must be 20 or 50")
    if page < 1:
        raise ValueError("page must be >= 1")
    if dataset_type not in {"system", "manual"}:
        raise ValueError("dataset_type must be system or manual")
    if route_date_from > route_date_to:
        raise ValueError("route_date_from must be <= route_date_to")
    wh = (warehouse_name or "").strip()
    offset = (page - 1) * page_size
    if dataset_type == "system":
        base = db.query(SysSuggest).filter(
            SysSuggest.is_active == 1,
            SysSuggest.route_date >= route_date_from,
            SysSuggest.route_date <= route_date_to,
        )
        opt_rows = base.with_entities(SysSuggest.warehouse_name).distinct().all()
        warehouse_options = sorted({str(n[0]).strip() for n in opt_rows if n[0]})
        q = base
        if wh:
            q = q.filter(SysSuggest.warehouse_name == wh)
        total = q.count()
        rows = q.order_by(SysSuggest.id).offset(offset).limit(page_size).all()
        items = [_suggest_row_dict(r) for r in rows]
    else:
        base = db.query(ManualRoute).filter(
            ManualRoute.is_active == 1,
            ManualRoute.route_date >= route_date_from,
            ManualRoute.route_date <= route_date_to,
        )
        opt_rows = base.with_entities(ManualRoute.warehouse_name).distinct().all()
        warehouse_options = sorted({str(n[0]).strip() for n in opt_rows if n[0]})
        q = base
        if wh:
            q = q.filter(ManualRoute.warehouse_name == wh)
        total = q.count()
        rows = q.order_by(ManualRoute.id).offset(offset).limit(page_size).all()
        items = [_manual_row_dict(r) for r in rows]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "warehouse_options": warehouse_options,
    }
