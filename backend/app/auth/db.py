"""Database engine / session wiring for user tracking.

One code path, two backends, selected purely by the DATABASE_URL env var:
  • unset           -> SQLite file on the persistent storage volume
  • postgresql://…  -> Neon / Supabase / any Postgres (durable, dashboard)

Switching backends requires no code change, only the env var.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from ..core.config import DATABASE_URL

Base = declarative_base()


def _normalize_url(url: str) -> str:
    # SQLAlchemy 2.x requires the "postgresql" dialect name; Supabase/Heroku
    # connection strings sometimes use the legacy "postgres://" scheme.
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def _make_engine(url: str):
    # check_same_thread=False is required for SQLite under FastAPI's threadpool;
    # it is ignored (and rejected) by Postgres, so only pass it for sqlite.
    if url.startswith("sqlite"):
        # Ensure the parent directory exists (the storage volume may be empty).
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
        )
    return create_engine(url, pool_pre_ping=True)


engine = _make_engine(_normalize_url(DATABASE_URL))
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    """Create tables if they do not exist. Safe to call on every startup."""
    # Import models so they are registered on Base before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """Add columns introduced after the table was first created.

    create_all never ALTERs existing tables, so a users.db from an earlier
    version is missing `tracked_at`. Add it idempotently (works on SQLite and
    Postgres). Pre-existing rows get NULL, so the retry loop back-fills them.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    try:
        columns = {c["name"] for c in inspector.get_columns("users")}
    except Exception:
        return  # table not present yet — create_all will have made it

    if "tracked_at" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN tracked_at TIMESTAMP"))


def get_db():
    """FastAPI dependency yielding a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
