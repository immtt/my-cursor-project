import os
import shutil
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

from app.api.admin_routes import admin_router
from app.api.deps_auth import get_current_user, verify_bearer_token
from app.db.session import get_db
from app.models.entities import AppUser, CompareRunLog
from app.schemas.requests import (
    CompareRequest,
    CustomerProfileCreate,
    CustomerProfileUpdate,
    ManualBackfillRequest,
    WarehouseBaseCreate,
    WarehouseBaseUpdate,
    StoreCoordinateCreate,
    StoreCoordinateUpdate,
    StorePairDistanceCreate,
    StorePairDistanceUpdate,
    UserPublic,
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
from app.services.warehouse_base_service import (
    batch_supplement_warehouse_base_coordinates,
    build_warehouse_base_export_xlsx_bytes,
    business_brand_to_item,
    create_warehouse_base,
    delete_warehouse_base,
    get_warehouse_base,
    import_warehouse_workbook,
    list_warehouse_base_filter_options,
    list_warehouse_bases,
    update_warehouse_base,
    warehouse_base_to_item,
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

router = APIRouter(dependencies=[Depends(verify_bearer_token)])


@router.get("/auth/me", response_model=UserPublic)
def auth_me(user: AppUser = Depends(get_current_user)):
    return UserPublic.model_validate(user)


@router.post("/auth/logout")
def auth_logout():
    return {"ok": True}


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


# ---------- 仓库基础数据（仓网规划 / 与「仓管理」Excel 对齐 + 集团） ----------


@router.post("/warehouse-base/import")
async def api_warehouse_base_import(
    file: UploadFile = File(...),
    data_source: str = Query("仓管理导入", description="来源标记，写入 import_source"),
    db: Session = Depends(get_db),
):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        try:
            return import_warehouse_workbook(
                db, tmp_path, import_source=(data_source or "仓管理导入").strip() or "仓管理导入"
            )
        except BadZipFile as e:
            raise HTTPException(status_code=400, detail="请上传有效的 .xlsx 文件") from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    finally:
        os.remove(tmp_path)


@router.get("/warehouse-base/filter-options")
def api_warehouse_base_filter_options(db: Session = Depends(get_db)):
    return list_warehouse_base_filter_options(db)


@router.get("/warehouse-base/export")
def api_warehouse_base_export(
    warehouse: str = Query("", description="筛：仓库代码或名称，模糊（子串）"),
    group_name: str = Query("", description="筛：集团，精确"),
    owning_org: str = Query("", description="筛：所属组织，精确"),
    brand: str = Query("", description="筛：品牌，精确"),
    status: str = Query("", description="筛：状态，精确"),
    warehouse_type: str = Query("", description="筛：仓库类型，精确"),
    db: Session = Depends(get_db),
):
    content = build_warehouse_base_export_xlsx_bytes(
        db,
        warehouse=warehouse,
        group_name=group_name,
        owning_org=owning_org,
        brand=brand,
        status=status,
        warehouse_type=warehouse_type,
    )
    name = "仓管理.xlsx"
    disp = f'attachment; filename="warehouse_base.xlsx"; filename*=UTF-8\'\'{quote(name)}'
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disp},
    )


@router.post("/warehouse-base/batch-geocode")
def api_batch_geocode_warehouse_base(
    only_missing: bool = Query(
        True,
        description="为真时仅补全「仓库坐标」为空的行；为假时按当前地址重新解析并覆盖",
    ),
    warehouse: str = Query("", description="与列表同：仓库代码/名称，模糊"),
    group_name: str = Query(""),
    owning_org: str = Query(""),
    brand: str = Query(""),
    status: str = Query(""),
    warehouse_type: str = Query(""),
    db: Session = Depends(get_db),
):
    return batch_supplement_warehouse_base_coordinates(
        db,
        only_missing=only_missing,
        warehouse=warehouse,
        group_name=group_name,
        owning_org=owning_org,
        brand=brand,
        status=status,
        warehouse_type=warehouse_type,
    )


@router.get("/warehouse-base")
def api_list_warehouse_base(
    warehouse: str = Query("", description="筛：仓库代码或名称，模糊（子串）"),
    group_name: str = Query("", description="筛：集团，精确"),
    owning_org: str = Query("", description="筛：所属组织，精确"),
    brand: str = Query("", description="筛：品牌，精确"),
    status: str = Query("", description="筛：状态，精确"),
    warehouse_type: str = Query("", description="筛：仓库类型，精确"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    total, rows = list_warehouse_bases(
        db,
        skip=skip,
        limit=limit,
        warehouse=warehouse,
        group_name=group_name,
        owning_org=owning_org,
        brand=brand,
        status=status,
        warehouse_type=warehouse_type,
    )
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [warehouse_base_to_item(r) for r in rows],
    }


@router.post("/warehouse-base")
def api_create_warehouse_base(req: WarehouseBaseCreate, db: Session = Depends(get_db)):
    try:
        row = create_warehouse_base(db, req.model_dump())
        return warehouse_base_to_item(row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/warehouse-base/{row_id}")
def api_get_warehouse_base(row_id: int, db: Session = Depends(get_db)):
    row = get_warehouse_base(db, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return warehouse_base_to_item(row)


@router.put("/warehouse-base/{row_id}")
def api_update_warehouse_base(
    row_id: int, req: WarehouseBaseUpdate, db: Session = Depends(get_db)
):
    try:
        row = update_warehouse_base(db, row_id, req.model_dump(exclude_unset=True))
        if not row:
            raise HTTPException(status_code=404, detail="NOT_FOUND")
        return warehouse_base_to_item(row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/warehouse-base/{row_id}")
def api_delete_warehouse_base(row_id: int, db: Session = Depends(get_db)):
    if not delete_warehouse_base(db, row_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {"ok": True}


@router.post("/warehouse-base/business-brands/{bb_id}/file")
async def api_upload_warehouse_business_brand_logo(
    bb_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    from app.models.entities import WarehouseBusinessBrand
    from app.business.warehouse_brand_uploads import ensure_upload_root

    bb = db.get(WarehouseBusinessBrand, bb_id)
    if not bb:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    name = (file.filename or "").lower()
    ext = os.path.splitext(name)[1] or ".png"
    if ext.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"):
        raise HTTPException(status_code=400, detail="不支持的图片类型")
    dest_dir = ensure_upload_root()
    rel = f"wb{bb.warehouse_id}_{bb_id}{ext}"
    path = dest_dir / rel
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    bb.logo_path = rel
    db.add(bb)
    db.commit()
    db.refresh(bb)
    return business_brand_to_item(bb)


@router.get("/warehouse-base/business-brands/{bb_id}/file")
def api_serve_warehouse_business_brand_logo(bb_id: int, db: Session = Depends(get_db)):
    from app.models.entities import WarehouseBusinessBrand
    from app.business.warehouse_brand_uploads import UPLOAD_WB_BRAND, ensure_upload_root

    bb = db.get(WarehouseBusinessBrand, bb_id)
    if not bb or not (bb.logo_path or "").strip():
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    base = ensure_upload_root().resolve()
    p = (base / bb.logo_path).resolve()
    if not str(p).startswith(str(base)) or not p.is_file():
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    ext = p.suffix.lower()
    media = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon"}.get(
        ext, "application/octet-stream"
    )
    return FileResponse(p, media_type=media)


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


router.include_router(admin_router, prefix="/admin", tags=["admin"])
