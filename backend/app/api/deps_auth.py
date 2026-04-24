import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import AppUser
from app.services.auth_service import decode_access_token


def verify_bearer_token(request: Request) -> None:
    if request.method == "OPTIONS":
        return
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_access_token(token)
        uid = int(str(payload.get("sub", "0")) or 0)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if uid <= 0:
        raise HTTPException(status_code=401, detail="Invalid token")
    request.state.user_id = uid


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> AppUser:
    uid = getattr(request.state, "user_id", None)
    if uid is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(AppUser).filter(AppUser.id == uid).one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User inactive or not found")
    return user


def get_current_admin_user(user: AppUser = Depends(get_current_user)) -> AppUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return user
