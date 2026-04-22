import os
import tempfile
import time
import uuid
from datetime import date, timedelta
from typing import Optional
from urllib.parse import quote
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import CompareRunLog
from app.schemas.requests import (
    CompareRequest,
    CustomerProfileCreate,
    CustomerProfileUpdate,
    ManualBackfillRequest,
    StoreCoordinateCreate,
    StoreCoordinateUpdate,
    StorePairDistanceCreate,
    StorePairDistanceUpdate,
)
from app.services.compare_service import overview, refresh_compare_after_import, run_compare
from app.services.diff_analysis_service import list_multi_vehicle_stores
from app.services.gaode_service import (
    backfill_manual_routes_by_batch,
    backfill_manual_routes_by_date_window,
)
from app.services.import_service import build_import_template_xlsx, import_excel
from app.services.result_service import export_results_csv, fetch_results
from app.services.route_map_service import build_route_map_payload
from app.services.customer_list_import import import_customer_list_workbook
from app.services.customer_profile_service import (
    build_customer_profile_export_xlsx_bytes,
    create_customer_profile,
    customer_profile_to_item,
    delete_customer_profile,
    get_customer_profile,
    list_customer_profiles,
    update_customer_profile,
)
from app.services.store_distance_excel import build_export_xlsx_bytes, import_workbook_path
from app.services.store_master_service import (
    create_store_coordinate,
    create_store_pair_distance,
    delete_store_coordinate,
    delete_store_pair_distance,
    get_store_coordinate,
    get_store_pair_distance,
    list_store_coordinates,
    list_store_pair_distances,
    update_store_coordinate,
    update_store_pair_distance,
)

router = APIRouter()


# 路径不可使用 /import/template 或 /import/rows：POST /import/{dataset_type} 会先匹配
# dataset_type=template|rows，GET 则 405。独立路径避免与动态段冲突（同 import-template）。
@router.post("/customer-list/import")
async def api_import_customer_list(
    file: UploadFile = File(...),
    data_source: str = Query("客户列表导入", description="来源标记，写入客户表与门店坐标 data_source"),
    db: Session = Depends(get_db),
):
    """导入「客户列表」Excel：写入 `customer_profile`，并用「收货坐标」更新 `store_coordinate`。"""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        try:
            return import_customer_list_workbook(
                db, tmp_path, import_source=(data_source or "客户列表导入").strip() or "客户列表导入"
            )
        except BadZipFile as e:
            raise HTTPException(
                status_code=400,
                detail="请上传有效的 .xlsx 文件",
            ) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    finally:
        os.remove(tmp_path)


@router.get("/customer-profiles/export")
def api_customer_profiles_export(db: Session = Depends(get_db)):
    content = build_customer_profile_export_xlsx_bytes(db)
    name = "客户列表.xlsx"
    disp = f'attachment; filename="customer_profiles.xlsx"; filename*=UTF-8\'\'{quote(name)}'
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disp},
    )


@router.get("/customer-profiles")
def api_list_customer_profiles(
    search: str = Query("", description="按客户代码、客户名称模糊搜索"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    total, rows = list_customer_profiles(db, search=search, skip=skip, limit=limit)
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [customer_profile_to_item(r) for r in rows],
    }


@router.post("/customer-profiles")
def api_create_customer_profile(req: CustomerProfileCreate, db: Session = Depends(get_db)):
    try:
        row = create_customer_profile(db, req.model_dump())
        return customer_profile_to_item(row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/customer-profiles/{row_id}")
def api_get_customer_profile(row_id: int, db: Session = Depends(get_db)):
    row = get_customer_profile(db, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return customer_profile_to_item(row)


@router.put("/customer-profiles/{row_id}")
def api_update_customer_profile(
    row_id: int, req: CustomerProfileUpdate, db: Session = Depends(get_db)
):
    try:
        row = update_customer_profile(db, row_id, req.model_dump(exclude_unset=True))
        if not row:
            raise HTTPException(status_code=404, detail="NOT_FOUND")
        return customer_profile_to_item(row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/customer-profiles/{row_id}")
def api_delete_customer_profile(row_id: int, db: Session = Depends(get_db)):
    if not delete_customer_profile(db, row_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {"ok": True}


@router.get("/import-template")
def download_import_template(dataset_type: str = Query(..., description="system | manual")):
    if dataset_type not in {"system", "manual"}:
        raise HTTPException(status_code=400, detail="dataset_type must be system or manual")
    try:
        content, filename = build_import_template_xlsx(dataset_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    ascii_name = "smart_route_import_system.xlsx" if dataset_type == "system" else "smart_route_import_manual.xlsx"
    disp = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disp},
    )


# 本批行查询 GET /api/import-batch 在 app/main.py 注册（与 /health 同应用，拉模板仍在 routes 的 import-template，策略一致，避免重复）


@router.post("/import/{dataset_type}")
async def import_data(
    dataset_type: str,
    file: UploadFile = File(...),
    x_operator: Optional[str] = Header(default="system"),
    db: Session = Depends(get_db),
):
    if dataset_type not in {"system", "manual"}:
        raise HTTPException(status_code=400, detail="dataset_type must be system or manual")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        try:
            result = import_excel(db, dataset_type, tmp_path, operator=x_operator or "system")
        except BadZipFile as e:
            raise HTTPException(status_code=400, detail="请上传有效的 .xlsx 文件（非 zip/xlsx 格式无法解析）") from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if (result.get("success_rows") or 0) > 0 and result.get("touched_route_dates"):
            try:
                dates = [date.fromisoformat(str(s)) for s in result["touched_route_dates"] if s]
                if dates:
                    result["compare_refresh"] = refresh_compare_after_import(db, dates)
            except (ValueError, TypeError) as e:
                result["compare_refresh"] = {"error": str(e)}
    finally:
        os.remove(tmp_path)
    return result


@router.post("/manual/backfill")
def manual_backfill_routes(req: ManualBackfillRequest, db: Session = Depends(get_db)):
    try:
        if (req.batch_id or "").strip():
            result = backfill_manual_routes_by_batch(db, req.batch_id.strip())
        else:
            result = backfill_manual_routes_by_date_window(db, req.route_date_from, req.route_date_to)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/compare/run")
def trigger_compare(req: CompareRequest, x_operator: Optional[str] = Header(default="system"), db: Session = Depends(get_db)):
    start = time.time()
    run_batch_id = uuid.uuid4().hex[:16]
    calc_result = backfill_manual_routes_by_date_window(db, req.route_date_from, req.route_date_to)
    result_count = 0
    d = req.route_date_from
    while d <= req.route_date_to:
        result_count += run_compare(db, d, req.match_threshold)
        d += timedelta(days=1)
    duration_ms = int((time.time() - start) * 1000)
    db.add(
        CompareRunLog(
            run_batch_id=run_batch_id,
            route_date=req.route_date_from,
            operator=x_operator or "system",
            duration_ms=duration_ms,
            result_count=result_count,
        )
    )
    db.commit()
    return {
        "message": "compare finished",
        "run_batch_id": run_batch_id,
        "route_date_from": req.route_date_from,
        "route_date_to": req.route_date_to,
        "calc": calc_result,
        "result_count": result_count,
    }


@router.get("/diff-analysis/multi-vehicle-stores")
def get_diff_analysis_multi_vehicle_stores(
    route_date_from: date = Query(..., description="排线日期起 YYYY-MM-DD（含）"),
    route_date_to: date = Query(..., description="排线日期止 YYYY-MM-DD（含）"),
    dataset_type: str = Query(
        ...,
        description="all（不合并，手工/系统分侧一店多车）| system | manual",
    ),
    warehouse_name: Optional[str] = Query(None, description="始发仓库，精确匹配；不传为全部"),
    db: Session = Depends(get_db),
):
    if route_date_from > route_date_to:
        raise HTTPException(
            status_code=400, detail="route_date_from 不能晚于 route_date_to"
        )
    try:
        return list_multi_vehicle_stores(
            db, route_date_from, route_date_to, dataset_type, warehouse_name
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/compare/overview")
def get_overview(
    route_date_from: date = Query(..., description="排线日期起 YYYY-MM-DD（含）"),
    route_date_to: date = Query(..., description="排线日期止 YYYY-MM-DD（含）"),
    warehouse_name: Optional[str] = Query(None, description="始发仓库，精确匹配；不传为全部"),
    db: Session = Depends(get_db),
):
    if route_date_from > route_date_to:
        raise HTTPException(status_code=400, detail="route_date_from 不能晚于 route_date_to")
    return overview(db, route_date_from, route_date_to, warehouse_name)


@router.get("/compare/results")
def get_results(
    route_date_from: date = Query(..., description="排线日期起 YYYY-MM-DD（含）"),
    route_date_to: date = Query(..., description="排线日期止 YYYY-MM-DD（含）"),
    match_status: Optional[str] = Query(None),
    warehouse_name: Optional[str] = Query(None, description="始发仓库，精确匹配；不传为全部"),
    db: Session = Depends(get_db),
):
    if route_date_from > route_date_to:
        raise HTTPException(status_code=400, detail="route_date_from 不能晚于 route_date_to")
    return fetch_results(db, route_date_from, route_date_to, match_status, warehouse_name)


@router.get("/compare/route-map/{compare_result_id}")
def get_route_map(compare_result_id: int, db: Session = Depends(get_db)):
    try:
        return build_route_map_payload(db, compare_result_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="NOT_FOUND")


@router.get("/compare/export")
def export_results(
    route_date_from: date = Query(..., description="排线日期起 YYYY-MM-DD（含）"),
    route_date_to: date = Query(..., description="排线日期止 YYYY-MM-DD（含）"),
    warehouse_name: Optional[str] = Query(None, description="始发仓库，精确匹配；不传为全部"),
    db: Session = Depends(get_db),
):
    if route_date_from > route_date_to:
        raise HTTPException(status_code=400, detail="route_date_from 不能晚于 route_date_to")
    rows = fetch_results(db, route_date_from, route_date_to, None, warehouse_name)
    tag = f"{route_date_from}_{route_date_to}" if route_date_from != route_date_to else f"{route_date_from}"
    file_path = os.path.join(tempfile.gettempdir(), f"compare_result_{tag}.csv")
    export_results_csv(file_path, rows)
    return FileResponse(file_path, filename=f"compare_result_{tag}.csv", media_type="text/csv")


# --- 仓店距离 / 门店坐标 管理（CRUD + 导入导出）


@router.get("/store-coordinates")
def api_list_store_coordinates(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return list_store_coordinates(db, skip=skip, limit=limit, search=search)


@router.post("/store-coordinates")
def api_create_store_coordinates(body: StoreCoordinateCreate, db: Session = Depends(get_db)):
    try:
        r = create_store_coordinate(
            db,
            store_name=body.store_name,
            longitude=body.longitude,
            latitude=body.latitude,
            data_source=body.data_source,
        )
        return {
            "id": r.id,
            "store_name": r.store_name,
            "longitude": r.longitude,
            "latitude": r.latitude,
            "data_source": r.data_source,
        }
    except ValueError as e:
        if "已存在" in str(e):
            raise HTTPException(status_code=409, detail=str(e)) from e
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/store-coordinates/{row_id}")
def api_get_store_coordinate(row_id: int, db: Session = Depends(get_db)):
    r = get_store_coordinate(db, row_id)
    if not r:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {
        "id": r.id,
        "store_name": r.store_name,
        "longitude": r.longitude,
        "latitude": r.latitude,
        "data_source": r.data_source,
    }


@router.put("/store-coordinates/{row_id}")
def api_update_store_coordinate(
    row_id: int, body: StoreCoordinateUpdate, db: Session = Depends(get_db)
):
    try:
        r = update_store_coordinate(
            db,
            row_id,
            store_name=body.store_name,
            longitude=body.longitude,
            latitude=body.latitude,
            data_source=body.data_source,
        )
        return {
            "id": r.id,
            "store_name": r.store_name,
            "longitude": r.longitude,
            "latitude": r.latitude,
            "data_source": r.data_source,
        }
    except ValueError as e:
        d = str(e)
        if d == "NOT_FOUND":
            raise HTTPException(status_code=404, detail="NOT_FOUND") from e
        if "已存在" in d:
            raise HTTPException(status_code=409, detail=d) from e
        raise HTTPException(status_code=400, detail=d) from e


@router.delete("/store-coordinates/{row_id}")
def api_delete_store_coordinate(row_id: int, db: Session = Depends(get_db)):
    if not delete_store_coordinate(db, row_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {"ok": True}


@router.get("/store-pair-distances")
def api_list_store_pair_distances(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return list_store_pair_distances(db, skip=skip, limit=limit, search=search)


@router.post("/store-pair-distances")
def api_create_store_pair_distances(
    body: StorePairDistanceCreate, db: Session = Depends(get_db)
):
    try:
        r = create_store_pair_distance(
            db,
            store_from=body.store_from,
            store_to=body.store_to,
            distance_km=body.distance_km,
        )
        return {
            "id": r.id,
            "store_from": r.store_from,
            "store_to": r.store_to,
            "distance_km": r.distance_km,
        }
    except ValueError as e:
        if "已存在" in str(e):
            raise HTTPException(status_code=409, detail=str(e)) from e
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/store-pair-distances/{row_id}")
def api_get_store_pair_distance(row_id: int, db: Session = Depends(get_db)):
    r = get_store_pair_distance(db, row_id)
    if not r:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {
        "id": r.id,
        "store_from": r.store_from,
        "store_to": r.store_to,
        "distance_km": r.distance_km,
    }


@router.put("/store-pair-distances/{row_id}")
def api_update_store_pair_distance(
    row_id: int, body: StorePairDistanceUpdate, db: Session = Depends(get_db)
):
    try:
        r = update_store_pair_distance(
            db,
            row_id,
            store_from=body.store_from,
            store_to=body.store_to,
            distance_km=body.distance_km,
        )
        return {
            "id": r.id,
            "store_from": r.store_from,
            "store_to": r.store_to,
            "distance_km": r.distance_km,
        }
    except ValueError as e:
        d = str(e)
        if d == "NOT_FOUND":
            raise HTTPException(status_code=404, detail="NOT_FOUND") from e
        if "已存在" in d:
            raise HTTPException(status_code=409, detail=d) from e
        raise HTTPException(status_code=400, detail=d) from e


@router.delete("/store-pair-distances/{row_id}")
def api_delete_store_pair_distance(row_id: int, db: Session = Depends(get_db)):
    if not delete_store_pair_distance(db, row_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {"ok": True}


@router.get("/store-master/export")
def api_store_master_export(db: Session = Depends(get_db)):
    content = build_export_xlsx_bytes(db)
    name = "智能排线_仓店距离与门店坐标.xlsx"
    disp = f'attachment; filename="store_master_export.xlsx"; filename*=UTF-8\'\'{quote(name)}'
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disp},
    )


@router.post("/store-master/import")
async def api_store_master_import(
    file: UploadFile = File(...),
    data_source: str = Query("页面导入", description="写入 store_coordinate.data_source 的标记"),
    db: Session = Depends(get_db),
):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        try:
            stats = import_workbook_path(db, tmp_path, (data_source or "页面导入").strip() or "页面导入")
        except BadZipFile as e:
            raise HTTPException(
                status_code=400,
                detail="请上传有效的 .xlsx 文件",
            ) from e
    finally:
        os.remove(tmp_path)
    return {"message": "import finished", "stats": stats}
