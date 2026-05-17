import os
import tempfile
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.requests import CompareRequest
from app.services.compare_service import overview, run_compare
from app.services.gaode_service import backfill_manual_routes
from app.services.import_service import import_excel
from app.services.result_service import export_results_csv, fetch_results

router = APIRouter()


@router.post("/import/{dataset_type}")
async def import_data(dataset_type: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if dataset_type not in {"system", "manual"}:
        raise HTTPException(status_code=400, detail="dataset_type must be system or manual")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    try:
        result = import_excel(db, dataset_type, tmp_path)
    finally:
        os.remove(tmp_path)
    return result


@router.post("/compare/run")
def trigger_compare(req: CompareRequest, db: Session = Depends(get_db)):
    calc_result = backfill_manual_routes(db, req.route_date)
    compare_result = run_compare(db, req.route_date, req.match_threshold)
    return {"message": "compare finished", "calc": calc_result, "compare": compare_result}


@router.get("/compare/overview")
def get_overview(route_date: date = Query(...), db: Session = Depends(get_db)):
    return overview(db, route_date)


@router.get("/compare/results")
def get_results(route_date: date = Query(...), match_status: str | None = Query(None), db: Session = Depends(get_db)):
    return fetch_results(db, route_date, match_status)


@router.get("/compare/export")
def export_results(route_date: date = Query(...), db: Session = Depends(get_db)):
    rows = fetch_results(db, route_date)
    file_path = os.path.join(tempfile.gettempdir(), f"compare_result_{route_date}.csv")
    export_results_csv(file_path, rows)
    return FileResponse(file_path, filename=f"compare_result_{route_date}.csv", media_type="text/csv")
