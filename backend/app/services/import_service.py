import re
import uuid
from datetime import date, datetime
from io import BytesIO
from typing import Dict, Tuple

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


def build_import_template_xlsx(dataset_type: str) -> Tuple[bytes, str]:
    """生成与导入规则一致的标准 Excel 模板（含表头 + 一行示例）。"""
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
                "预计公里数",
                "预计时效",
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
    for route_date in touched_dates:
        if dataset_type == "system":
            db.query(SysSuggest).filter(SysSuggest.route_date == route_date, SysSuggest.is_active == 1).update(
                {"is_active": 0}
            )
        else:
            db.query(ManualRoute).filter(ManualRoute.route_date == route_date, ManualRoute.is_active == 1).update(
                {"is_active": 0}
            )

    imported_at = datetime.now()
    for obj in staged_records:
        obj.batch_id = batch_id
        obj.is_active = 1
        obj.import_operator = operator
        obj.imported_at = imported_at
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
