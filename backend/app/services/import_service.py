from datetime import datetime

from openpyxl import load_workbook
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
    if value is None:
        raise ValueError("排线日期不能为空")
    if hasattr(value, "date"):
        return value.date()
    return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()


def _required_text(value, column_name: str) -> str:
    if value is None:
        raise ValueError(f"{column_name}不能为空")
    text = str(value).strip()
    if not text:
        raise ValueError(f"{column_name}不能为空")
    return text


def _required_float(value, column_name: str) -> float:
    if value is None or str(value).strip() == "":
        raise ValueError(f"{column_name}不能为空")
    return float(value)


def _load_rate(value) -> float:
    if value is None or str(value).strip() == "":
        raise ValueError("装载率不能为空")
    return float(str(value).replace("%", ""))


def _optional_number(values, header_map, column_name: str, parser):
    idx = header_map.get(column_name)
    if idx is None:
        return None
    value = values[idx]
    if value is None or str(value).strip() == "":
        return None
    return parser(value)


def _delete_replaced_rows(db: Session, model, keys):
    for route_date, waybill_no in keys:
        db.query(model).filter(
            model.route_date == route_date,
            model.waybill_no == waybill_no,
        ).delete(synchronize_session="fetch")


def import_excel(db: Session, dataset_type: str, file_path: str):
    wb = load_workbook(file_path)
    sheet = wb.active
    headers = [str(cell.value).strip() if cell.value else "" for cell in sheet[1]]
    header_map = {name: idx for idx, name in enumerate(headers)}

    errors = []
    total_rows = 0
    success_rows = 0
    parsed_rows = []
    replace_keys = set()
    affected_dates = set()

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
            waybill_no = _required_text(values[header_map["运单号"]], "运单号")
            route_line = _required_text(values[header_map["归属线路"]], "归属线路")
            warehouse_name = _required_text(values[header_map["始发仓库"]], "始发仓库")
            stores = _required_text(values[header_map["拼载门店"]], "拼载门店")
            volume = _required_float(values[header_map["配送体积"]], "配送体积")
            load_rate = _load_rate(values[header_map["装载率"]])

            if volume < 0:
                raise ValueError("配送体积不能为负数")

            if dataset_type == "system":
                est_distance = _optional_number(values, header_map, "预计公里数", float)
                est_duration = _optional_number(values, header_map, "预计时效", lambda v: int(float(v)))
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
                obj = ManualRoute(
                    route_date=route_date,
                    waybill_no=waybill_no,
                    route_line=route_line,
                    warehouse_name=warehouse_name,
                    stores=stores,
                    volume=volume,
                    load_rate=load_rate,
                )
            parsed_rows.append(obj)
            replace_keys.add((route_date, waybill_no))
            affected_dates.add(route_date)
            success_rows += 1
        except Exception as exc:
            errors.append({"row": row_no, "reason": str(exc)})

    if parsed_rows:
        model = SysSuggest if dataset_type == "system" else ManualRoute
        db.query(CompareResult).filter(CompareResult.route_date.in_(affected_dates)).delete(
            synchronize_session="fetch"
        )
        _delete_replaced_rows(db, model, replace_keys)
        db.add_all(parsed_rows)
    db.commit()
    return {
        "total_rows": total_rows,
        "success_rows": success_rows,
        "failed_rows": total_rows - success_rows,
        "errors": errors,
    }
