"""业务品牌 LOGO 本地上传目录；相对路径存库，经 API 只读下裁。"""

from pathlib import Path

from app.core.config import backend_root

UPLOAD_WB_BRAND = backend_root / "uploads" / "warehouse_business_logos"


def ensure_upload_root() -> Path:
    UPLOAD_WB_BRAND.mkdir(parents=True, exist_ok=True)
    return UPLOAD_WB_BRAND
