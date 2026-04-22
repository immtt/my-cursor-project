from fastapi import FastAPI

from app.api.routes import router
from app.db.session import Base, engine

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Smart Route Compare API")
app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
