"""Reliable central signup tracking via the Supabase REST API.

Design: the local DB is the durable queue. Every user row has `tracked_at`;
NULL means "not yet pushed to Supabase". On signup we try once immediately; a
background retry loop re-attempts every unsent row on an interval, so nothing
is lost if Supabase is briefly down or unconfigured — it gets pushed once the
service is reachable, even across restarts. Inserts are idempotent (the central
table has UNIQUE(email) + ignore-duplicates), so retries never create dupes.

This is "how many people use the app" analytics; it must never block or break
signup, and never sends the password hash.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from ..core.config import (
    APP_INSTANCE_ID,
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL,
    TRACKING_RETRY_INTERVAL,
)
from .db import SessionLocal
from .models import User

logger = logging.getLogger("renaissance.auth.tracking")


def tracking_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY)


def _post_signup(user: User) -> bool:
    """POST one signup to Supabase. Returns True on success (incl. duplicate)."""
    # Plain insert. We deliberately do NOT use PostgREST upsert
    # (on_conflict / resolution=ignore-duplicates): that path needs read/merge
    # rights and trips the insert-only RLS policy. Idempotency is handled two
    # ways instead: locally we only push rows with tracked_at=NULL (never
    # twice), and a cross-instance duplicate email simply returns 409 below,
    # which we treat as "already recorded".
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/users"
    headers = {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {SUPABASE_PUBLISHABLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    payload = {
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "institute": user.institute,
        "instance_id": APP_INSTANCE_ID,
    }
    try:
        resp = httpx.post(url, headers=headers, json=payload, timeout=8.0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[tracking] insert failed (will retry): %s", exc)
        return False

    # 2xx == inserted. 409 == this email is already in the central table (e.g.
    # the same person signed up on another instance) — that's "done", not an
    # error, so we mark it tracked and stop retrying.
    if resp.status_code < 300 or resp.status_code == 409:
        return True
    logger.warning(
        "[tracking] Supabase returned %s (will retry): %s",
        resp.status_code,
        resp.text[:300],
    )
    return False


def _flush_pending_sync() -> int:
    """Push every not-yet-tracked user. Returns how many were pushed."""
    if not tracking_enabled():
        return 0

    pushed = 0
    db = SessionLocal()
    try:
        pending = db.scalars(select(User).where(User.tracked_at.is_(None))).all()
        for user in pending:
            if _post_signup(user):
                user.tracked_at = datetime.now(timezone.utc)
                db.commit()
                pushed += 1
            else:
                db.rollback()  # leave tracked_at NULL -> retried next cycle
    finally:
        db.close()

    if pushed:
        logger.info("[tracking] Pushed %d signup(s) to Supabase", pushed)
    return pushed


def track_user_now(user_id: int) -> None:
    """Best-effort immediate push for a single new signup (BackgroundTask).

    If it fails, tracked_at stays NULL and the retry loop will get it later.
    """
    if not tracking_enabled():
        logger.info("[tracking] Supabase not configured — skipping (id=%s)", user_id)
        return
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None or user.tracked_at is not None:
            return
        if _post_signup(user):
            user.tracked_at = datetime.now(timezone.utc)
            db.commit()
            logger.info("[tracking] Recorded signup %s centrally", user.email)
    finally:
        db.close()


async def retry_loop() -> None:
    """Periodically flush unsent signups until they all land in Supabase."""
    # Immediate first pass on startup (back-fills anything missed while down).
    while True:
        try:
            await asyncio.to_thread(_flush_pending_sync)
        except Exception as exc:  # noqa: BLE001 — loop must never die
            logger.warning("[tracking] retry loop error: %s", exc)
        await asyncio.sleep(TRACKING_RETRY_INTERVAL)
