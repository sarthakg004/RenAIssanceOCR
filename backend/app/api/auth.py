"""Lightweight user-tracking auth routes.

Endpoints:
  POST /api/auth/signup        create account, send (or log) verification email
  POST /api/auth/login         verify credentials, set session cookie
  POST /api/auth/logout        clear session cookie
  GET  /api/auth/me            current user from the session cookie
  GET  /api/auth/verify-email  mark account verified, redirect to frontend
  GET  /api/admin/users        token-protected user count + list
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Header, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth.db import get_db
from ..auth.email_utils import send_verification_email
from ..auth.models import User
from ..auth.tracking import track_user_now
from ..auth.schemas import AuthResponse, LoginRequest, SignupRequest, UserOut
from ..auth.security import (
    SESSION_COOKIE,
    create_session_token,
    hash_password,
    new_verification_token,
    read_session_token,
    verify_password,
)
from ..core.config import ADMIN_TOKEN, PUBLIC_BASE_URL, SESSION_MAX_AGE

router = APIRouter()

# Cookie is marked Secure only when the public origin is https, so it still
# works over plain http on localhost during development.
_COOKIE_SECURE = PUBLIC_BASE_URL.lower().startswith("https")


def _set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(user_id),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def current_user(
    ren_session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Dependency: resolve the logged-in user or raise 401."""
    user_id = read_session_token(ren_session or "")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ── Signup ────────────────────────────────────────────────────────────────

@router.post("/api/auth/signup", response_model=AuthResponse)
def signup(
    payload: SignupRequest,
    response: Response,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    username = payload.username.strip()
    email = str(payload.email).strip().lower()

    existing = db.scalar(
        select(User).where((User.username == username) | (User.email == email))
    )
    if existing is not None:
        field = "username" if existing.username == username else "email"
        raise HTTPException(status_code=409, detail=f"That {field} is already registered")

    token = new_verification_token()
    user = User(
        username=username,
        email=email,
        name=payload.name.strip(),
        institute=(payload.institute or "").strip() or None,
        password_hash=hash_password(payload.password),
        is_verified=False,
        verification_token=token,
    )

    # Send the verification email. If SMTP is not configured this returns
    # False and logs the link — we then auto-verify so the account is usable
    # immediately (verification is for tracking, not a security gate).
    email_sent = send_verification_email(email, user.name, token)
    if not email_sent:
        user.is_verified = True
        user.verification_token = None

    db.add(user)
    db.commit()
    db.refresh(user)

    # Central tracking: try immediately after the response is sent. If it
    # fails (Supabase down/unreachable), tracked_at stays NULL and the
    # background retry loop pushes it later — nothing is lost.
    background_tasks.add_task(track_user_now, user.id)

    _set_session_cookie(response, user.id)
    return AuthResponse(user=UserOut(**user.public_dict()), email_sent=email_sent)


# ── Login ───────────────────────────────────────────────────────────────────

@router.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    ident = payload.username.strip()
    # Allow logging in with either username or email.
    user = db.scalar(
        select(User).where((User.username == ident) | (User.email == ident.lower()))
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    user.last_login = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    _set_session_cookie(response, user.id)
    return AuthResponse(user=UserOut(**user.public_dict()), email_sent=False)


# ── Logout ──────────────────────────────────────────────────────────────────

@router.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


# ── Current user ─────────────────────────────────────────────────────────────

@router.get("/api/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(**user.public_dict())


# ── Email verification ───────────────────────────────────────────────────────

@router.get("/api/auth/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    frontend = PUBLIC_BASE_URL.rstrip("/")
    user = db.scalar(select(User).where(User.verification_token == token))
    if user is None:
        # Token already consumed or invalid — bounce to the app with a flag.
        return RedirectResponse(url=f"{frontend}/?verified=already", status_code=303)

    user.is_verified = True
    user.verification_token = None
    db.commit()
    return RedirectResponse(url=f"{frontend}/?verified=success", status_code=303)


# ── Admin: user tracking view ────────────────────────────────────────────────

@router.get("/api/admin/users")
def admin_users(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    db: Session = Depends(get_db),
):
    # Disabled unless an ADMIN_TOKEN is configured — never left open.
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=404, detail="Not found")
    if not x_admin_token or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")

    total = db.scalar(select(func.count()).select_from(User)) or 0
    verified = db.scalar(
        select(func.count()).select_from(User).where(User.is_verified.is_(True))
    ) or 0
    users = db.scalars(select(User).order_by(User.created_at.desc())).all()
    return {
        "total_users": total,
        "verified_users": verified,
        "users": [u.public_dict() for u in users],
    }
