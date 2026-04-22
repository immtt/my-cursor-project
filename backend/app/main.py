from fastapi import FastAPI

from app.api.routes import router
from app.db.session import Base, engine
from app.middleware.dev_cors import DevCorsASGIMiddleware

Base.metadata.create_all(bind=engine)

_core = FastAPI(title="Smart Route Compare API")
_core.include_router(router, prefix="/api")


@_core.get("/health")
def health():
    return {"status": "ok"}


# uvicorn 入口：ASGI 最外层补 CORS，覆盖异常/非标准响应路径（仅本地开发）
app = DevCorsASGIMiddleware(_core)
