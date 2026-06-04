from datetime import datetime

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app.models.entities import ManualRoute, SysSuggest


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


def _is_blank(value) -> bool:
    return value is None or str(value).strip() == ""


def _required_text(values, header_map, column: str) -> str:
    value = values[header_map[column]]
    if _is_blank(value):
        raise ValueError("文本字段存在空值")
    return str(value).strip()


def _optional_float(values, header_map, column: str, default: float = 0.0) -> float:
    idx = header_map.get(column)
    if idx is None or _is_blank(values[idx]):
        return default
    return float(values[idx])


def _optional_int(values, header_map, column: str, default: int = 0) -> int:
    idx = header_map.get(column)
    if idx is None or _is_blank(values[idx]):
        return default
    return int(float(values[idx]))


def _upsert_row(db: Session, model, fields: dict):
    obj = (
        db.query(model)
        .filter(model.route_date == fields["route_date"], model.waybill_no == fields["waybill_no"])
        .first()
    )
    if obj is None:
        obj = model()
        db.add(obj)
    for key, value in fields.items():
        setattr(obj, key, value)
    db.flush()


def import_excel(db: Session, dataset_type: str, file_path: str):
    wb = load_workbook(file_path)
    sheet = wb.active
    headers = [str(cell.value).strip() if cell.value else "" for cell in sheet[1]]
    header_map = {name: idx for idx, name in enumerate(headers)}

    errors = []
    total_rows = 0
    success_rows = 0

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
            waybill_no = _required_text(values, header_map, "运单号")
            route_line = _required_text(values, header_map, "归属线路")
            warehouse_name = _required_text(values, header_map, "始发仓库")
            stores = _required_text(values, header_map, "拼载门店")
            volume = float(values[header_map["配送体积"]])
            load_rate = float(str(values[header_map["装载率"]]).replace("%", ""))

            if volume < 0:
                raise ValueError("配送体积不能为负数")

            fields = {
                "route_date": route_date,
                "waybill_no": waybill_no,
                "route_line": route_line,
                "warehouse_name": warehouse_name,
                "stores": stores,
                "volume": volume,
                "load_rate": load_rate,
            }
            if dataset_type == "system":
                fields.update(
                    {
                        "est_distance": _optional_float(values, header_map, "预计公里数"),
                        "est_duration": _optional_int(values, header_map, "预计时效"),
                    }
                )
                _upsert_row(db, SysSuggest, fields)
            else:
                fields.update(
                    {
                        "est_distance": None,
                        "est_duration": None,
                        "calc_status": 0,
                    }
                )
                _upsert_row(db, ManualRoute, fields)
            success_rows += 1
        except Exception as exc:
            errors.append({"row": row_no, "reason": str(exc)})

    db.commit()
    return {
        "total_rows": total_rows,
        "success_rows": success_rows,
        "failed_rows": total_rows - success_rows,
        "errors": errors,
    }
