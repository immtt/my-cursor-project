import os
import tempfile
import time
import uuid
from datetime import date
from typing import Optional
from urllib.parse import quote
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import CompareRunLog
from app.schemas.requests import CompareRequest, ManualBackfillRequest
from app.services.compare_service import overview, run_compare
from app.services.gaode_service import backfill_manual_routes, backfill_manual_routes_by_batch
from app.services.import_service import build_import_template_xlsx, import_excel
from app.services.result_service import export_results_csv, fetch_results
from app.services.route_map_service import build_route_map_payload

router = APIRouter()


# 路径不可使用 /import/template 或 /import/rows：POST /import/{dataset_type} 会先匹配
# dataset_type=template|rows，GET 则 405。独立路径避免与动态段冲突（同 import-template）。
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
    finally:
        os.remove(tmp_path)
    return result


@router.post("/manual/backfill")
def manual_backfill_routes(req: ManualBackfillRequest, db: Session = Depends(get_db)):
    bid = (req.batch_id or "").strip()
    if not bid:
        raise HTTPException(status_code=400, detail="batch_id required")
    try:
        return backfill_manual_routes_by_batch(db, bid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/compare/run")
def trigger_compare(req: CompareRequest, x_operator: Optional[str] = Header(default="system"), db: Session = Depends(get_db)):
    start = time.time()
    run_batch_id = uuid.uuid4().hex[:16]
    calc_result = backfill_manual_routes(db, req.route_date)
    result_count = run_compare(db, req.route_date, req.match_threshold)
    duration_ms = int((time.time() - start) * 1000)
    db.add(
        CompareRunLog(
            run_batch_id=run_batch_id,
            route_date=req.route_date,
            operator=x_operator or "system",
            duration_ms=duration_ms,
            result_count=result_count,
        )
    )
    db.commit()
    return {"message": "compare finished", "run_batch_id": run_batch_id, "calc": calc_result, "result_count": result_count}


@router.get("/compare/overview")
def get_overview(route_date: date = Query(...), db: Session = Depends(get_db)):
    return overview(db, route_date)


@router.get("/compare/results")
def get_results(route_date: date = Query(...), match_status: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return fetch_results(db, route_date, match_status)


@router.get("/compare/route-map/{compare_result_id}")
def get_route_map(compare_result_id: int, db: Session = Depends(get_db)):
    try:
        return build_route_map_payload(db, compare_result_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="NOT_FOUND")


@router.get("/compare/export")
def export_results(route_date: date = Query(...), db: Session = Depends(get_db)):
    rows = fetch_results(db, route_date)
    file_path = os.path.join(tempfile.gettempdir(), f"compare_result_{route_date}.csv")
    export_results_csv(file_path, rows)
    return FileResponse(file_path, filename=f"compare_result_{route_date}.csv", media_type="text/csv")
