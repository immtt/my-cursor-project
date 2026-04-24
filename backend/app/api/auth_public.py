from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import AppUser
from app.schemas.requests import AuthLoginRequest, AuthTokenResponse, UserPublic
from app.core.config import settings
from app.services.auth_service import create_access_token, verify_password

router = APIRouter()


@router.post("/auth/login", response_model=AuthTokenResponse)
def auth_login(body: AuthLoginRequest, db: Session = Depends(get_db)):
    if not (settings.auth_jwt_secret or "").strip():
        raise HTTPException(status_code=500, detail="Server auth is not configured (AUTH_JWT_SECRET)")
    u = (
        db.query(AppUser)
        .filter(AppUser.username == (body.username or "").strip())
        .one_or_none()
    )
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not u.is_active:
        raise HTTPException(status_code=401, detail="Account disabled")
    token, expires_in = create_access_token(u.id)
    return AuthTokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserPublic.model_validate(u),
    )
