from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, password_hash: str) -> bool:
    return _pwd.verify(plain, password_hash)


def create_access_token(user_id: int) -> tuple[str, int]:
    exp_min = settings.auth_jwt_expires_minutes
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=exp_min)
    if not (settings.auth_jwt_secret or "").strip():
        raise ValueError("AUTH_JWT_SECRET is not set")
    payload: dict[str, Any] = {"sub": str(user_id), "exp": exp, "iat": now}
    token = jwt.encode(payload, settings.auth_jwt_secret, algorithm="HS256")
    return token, int(exp_min * 60)


def decode_access_token(token: str) -> dict[str, Any]:
    if not (settings.auth_jwt_secret or "").strip():
        raise jwt.InvalidTokenError("missing secret")
    return jwt.decode(token, settings.auth_jwt_secret, algorithms=["HS256"])


def maybe_bootstrap_first_admin(_db: Optional[Session] = None) -> None:
    """当库中无用户且设置了 BOOTSTRAP_* 时创建首任管理员。`_db` 供单元测试注入会话；生产路径不传。"""
    from app.db.session import SessionLocal
    from app.models.entities import AppUser

    bu = (os.getenv("BOOTSTRAP_ADMIN_USER") or "").strip()
    bp = (os.getenv("BOOTSTRAP_ADMIN_PASS") or "").strip()
    if not bu or not bp:
        return
    close_db = _db is None
    db = _db or SessionLocal()
    try:
        if db.query(AppUser).count() > 0:
            return
        db.add(
            AppUser(
                username=bu,
                password_hash=hash_password(bp),
                is_active=True,
                is_admin=True,
            )
        )
        db.commit()
    finally:
        if close_db:
            db.close()
