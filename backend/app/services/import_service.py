from datetime import datetime
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.orm import Session

from app.models.entities import CompareResult, ManualRoute, SysSuggest


REQUIRED_COLUMNS = [
    "排线日期",
    "运单号",
    "归属线路",
    "始发仓库",
    "拼载门店",
    "配送体积",
    "装载率",
]


def _parse_date(value):
    if hasattr(value, "date"):
        return value.date()
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _required_text(value):
    if value is None:
        return ""
    return str(value).strip()


def _optional_value(values, header_map, name):
    idx = header_map.get(name)
    if idx is None or idx >= len(values):
        return None
    value = values[idx]
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def import_excel(db: Session, dataset_type: str, file_path: str):
    try:
        wb = load_workbook(file_path)
    except (BadZipFile, InvalidFileException, OSError) as exc:
        return {
            "total_rows": 0,
            "success_rows": 0,
            "failed_rows": 0,
            "errors": [{"row": 0, "reason": f"无法读取Excel文件: {exc}"}],
        }
    sheet = wb.active
    headers = [str(cell.value).strip() if cell.value else "" for cell in sheet[1]]
    header_map = {name: idx for idx, name in enumerate(headers)}

    errors = []
    total_rows = 0
    success_rows = 0
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
            waybill_no = _required_text(values[header_map["运单号"]])
            route_line = _required_text(values[header_map["归属线路"]])
            warehouse_name = _required_text(values[header_map["始发仓库"]])
            stores = _required_text(values[header_map["拼载门店"]])
            volume = float(values[header_map["配送体积"]])
            load_rate = float(str(values[header_map["装载率"]]).replace("%", ""))

            if not all([waybill_no, route_line, warehouse_name, stores]):
                raise ValueError("文本字段存在空值")
            if volume < 0:
                raise ValueError("配送体积不能为负数")

            if dataset_type == "system":
                est_distance_value = _optional_value(values, header_map, "预计公里数")
                est_duration_value = _optional_value(values, header_map, "预计时效")
                est_distance = float(est_distance_value) if est_distance_value is not None else None
                est_duration = int(est_duration_value) if est_duration_value is not None else None
                db.query(SysSuggest).filter(
                    SysSuggest.route_date == route_date,
                    SysSuggest.waybill_no == waybill_no,
                ).delete(synchronize_session=False)
                obj = SysSuggest(
                    route_date=route_date,
                    waybill_no=waybill_no,
                    route_line=route_line,
                    warehouse_name=warehouse_name,
                    stores=stores,
                    volume=volume,
                    load_rate=load_rate,
                    est_distance=est_distance,
                    est_duration=est_duration,
                )
            else:
                db.query(ManualRoute).filter(
                    ManualRoute.route_date == route_date,
                    ManualRoute.waybill_no == waybill_no,
                ).delete(synchronize_session=False)
                obj = ManualRoute(
                    route_date=route_date,
                    waybill_no=waybill_no,
                    route_line=route_line,
                    warehouse_name=warehouse_name,
                    stores=stores,
                    volume=volume,
                    load_rate=load_rate,
                )
            db.add(obj)
            touched_dates.add(route_date)
            success_rows += 1
        except Exception as exc:
            errors.append({"row": row_no, "reason": str(exc)})

    if touched_dates:
        db.query(CompareResult).filter(CompareResult.route_date.in_(touched_dates)).delete(
            synchronize_session=False
        )
    db.commit()
    return {
        "total_rows": total_rows,
        "success_rows": success_rows,
        "failed_rows": total_rows - success_rows,
        "errors": errors,
    }
