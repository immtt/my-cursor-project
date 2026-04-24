from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps_auth import get_current_admin_user
from app.db.session import get_db
from app.models.entities import AppUser
from app.schemas.requests import AdminUserCreate, AdminUserPatch, AdminResetPassword, UserPublic
from app.services.auth_service import hash_password

admin_router = APIRouter()


@admin_router.get("/users", response_model=list[UserPublic])
def list_users(
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_admin_user),
):
    rows = db.query(AppUser).order_by(AppUser.id).all()
    return [UserPublic.model_validate(r) for r in rows]


@admin_router.post("/users", response_model=UserPublic)
def create_user(
    body: AdminUserCreate,
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_admin_user),
):
    un = (body.username or "").strip()
    if not un:
        raise HTTPException(status_code=400, detail="username is required")
    if db.query(AppUser).filter(AppUser.username == un).first():
        raise HTTPException(status_code=400, detail="username already exists")
    u = AppUser(
        username=un,
        password_hash=hash_password(body.password),
        is_active=body.is_active,
        is_admin=body.is_admin,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return UserPublic.model_validate(u)


@admin_router.patch("/users/{user_id}", response_model=UserPublic)
def patch_user(
    user_id: int,
    body: AdminUserPatch,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(get_current_admin_user),
):
    u = db.query(AppUser).filter(AppUser.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    if u.id == admin.id and body.is_active is False:
        raise HTTPException(status_code=400, detail="不能禁用自己")
    if u.id == admin.id and body.is_admin is False:
        raise HTTPException(status_code=400, detail="不能取消自己的管理员权限")
    if body.is_active is not None:
        u.is_active = body.is_active
    if body.is_admin is not None:
        u.is_admin = body.is_admin
    db.commit()
    db.refresh(u)
    return UserPublic.model_validate(u)


@admin_router.post("/users/{user_id}/reset-password", response_model=UserPublic)
def reset_password(
    user_id: int,
    body: AdminResetPassword,
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_admin_user),
):
    u = db.query(AppUser).filter(AppUser.id == user_id).one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail="User not found")
    u.password_hash = hash_password(body.new_password)
    db.commit()
    db.refresh(u)
    return UserPublic.model_validate(u)
