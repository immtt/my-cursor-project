from datetime import date
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.routes import router
from app.db.session import Base, engine, ensure_sqlite_schema, get_db
import app.models.entities  # noqa: F401  — 全量注册 ORM 表（含新表）供 create_all
from app.middleware.dev_cors import DevCorsASGIMiddleware
from app.services.import_service import fetch_active_import_page, fetch_import_batch_page

Base.metadata.create_all(bind=engine)
ensure_sqlite_schema()

_core = FastAPI(title="Smart Route Compare API")
_core.include_router(router, prefix="/api")


# 与 import-template 同一策略的独立路径；挂在此处保证 uvicorn 入口 app.main:app 必含本 GET（若 openapi 无本 path，即未重载到当前文件）
@_core.get("/api/import-batch")
def api_import_batch(
    dataset_type: str = Query(..., description="system | manual"),
    batch_id: str = Query(..., description="导入接口返回的 batch_id"),
    page: int = Query(1, description="页码，从 1 起"),
    page_size: int = Query(20, description="每页条数，仅 20 或 50"),
    db: Session = Depends(get_db),
):
    if dataset_type not in {"system", "manual"}:
        raise HTTPException(status_code=400, detail="dataset_type must be system or manual")
    if page_size not in (20, 50):
        raise HTTPException(status_code=400, detail="page_size must be 20 or 50")
    try:
        return fetch_import_batch_page(db, dataset_type, batch_id, page, page_size)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@_core.get("/api/import-active")
def api_import_active(
    dataset_type: str = Query(..., description="system | manual"),
    route_date_from: date = Query(..., description="排线日期起 YYYY-MM-DD（含）"),
    route_date_to: date = Query(..., description="排线日期止 YYYY-MM-DD（含）"),
    page: int = Query(1, description="页码，从 1 起"),
    page_size: int = Query(20, description="每页条数，仅 20 或 50"),
    warehouse_name: Optional[str] = Query(None, description="始发仓库，精确匹配；不传表示全部"),
    db: Session = Depends(get_db),
):
    if dataset_type not in {"system", "manual"}:
        raise HTTPException(status_code=400, detail="dataset_type must be system or manual")
    if page_size not in (20, 50):
        raise HTTPException(status_code=400, detail="page_size must be 20 or 50")
    try:
        return fetch_active_import_page(
            db, dataset_type, route_date_from, route_date_to, page, page_size, warehouse_name
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@_core.get("/health")
def health():
    return {"status": "ok"}


# uvicorn 入口：ASGI 最外层补 CORS，覆盖异常/非标准响应路径（仅本地开发）
app = DevCorsASGIMiddleware(_core)
