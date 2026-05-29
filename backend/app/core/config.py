"""
Application-wide configuration constants.
"""

import os

# Load a local .env for non-Docker runs (e.g. `uvicorn app.main:app`). In
# Docker, compose's env_file already injects these into the real environment,
# and load_dotenv does NOT override existing vars — so this is a no-op there.
# Without this, a local run never sees .env (provider keys come from request
# headers), which is why SUPABASE_* tracking vars were silently empty locally.
try:
    from dotenv import load_dotenv

    _cfg_dir = os.path.dirname(os.path.abspath(__file__))
    for _env_candidate in (
        os.path.join(_cfg_dir, "..", "..", "..", ".env"),  # repo root
        os.path.join(_cfg_dir, "..", "..", ".env"),         # backend/
    ):
        if os.path.isfile(_env_candidate):
            load_dotenv(_env_candidate)
            break
except ImportError:
    pass


def _default_storage_root() -> str:
    """Resolve storage root for both local and containerized runs."""
    this_dir = os.path.dirname(os.path.abspath(__file__))
    backend_root = os.path.abspath(os.path.join(this_dir, "..", ".."))
    repo_root_candidate = os.path.abspath(os.path.join(backend_root, ".."))

    is_repo_layout = (
        os.path.isdir(os.path.join(repo_root_candidate, "backend"))
        and os.path.isdir(os.path.join(repo_root_candidate, "frontend"))
    )

    if is_repo_layout:
        return os.path.join(repo_root_candidate, "storage")
    return os.path.join(backend_root, "storage")

# FastAPI app metadata
APP_TITLE = "RenAIssance OCR API"
APP_VERSION = "2.0.0"

# CORS origins allowed by the backend
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
]

# Upload limits
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

# API-key format validation
MIN_API_KEY_LENGTH = 20

# Rate-limiting defaults (Gemini free-tier)
RATE_LIMIT_MAX_REQUESTS = 5
RATE_LIMIT_WINDOW_SECONDS = 60

# Batch OCR
MAX_BATCH_SIZE = 4

# Persistent storage root for "My Files"
STORAGE_ROOT = os.getenv("STORAGE_ROOT", _default_storage_root())


# ============================================================
# Lightweight user tracking / auth
#
# Every value here is a BACKEND-ONLY environment variable. None of it is
# ever sent to the browser — the frontend only receives an opaque, signed,
# httpOnly session cookie it cannot read or forge.
# ============================================================

# Where the LOCAL auth accounts live (per self-hosted instance). Defaults to a
# SQLite file on the persistent storage volume — zero setup, works offline, and
# never depends on any cloud service to log in. Advanced operators may point
# this at their own postgresql:// URL, but the shipped/default path is SQLite.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(STORAGE_ROOT, 'users.db')}",
)

# Secret used to sign session cookies and email-verification tokens. MUST be
# set to a stable random value in production; a per-process random fallback is
# used in dev (sessions then reset on every restart, which is fine locally).
SECRET_KEY = os.getenv("SECRET_KEY") or os.urandom(32).hex()

# Bearer token guarding GET /api/admin/users. If unset, the admin endpoint is
# disabled (returns 404) rather than left open.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

# Public origin used to build the email-verification link. Defaults to the
# local frontend; set to your deployed origin in production.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:5173")

# Session cookie lifetime (seconds). Default 30 days.
SESSION_MAX_AGE = int(os.getenv("SESSION_MAX_AGE", str(30 * 24 * 60 * 60)))

# SMTP for verification email. ALL optional — if SMTP_HOST is empty the app
# runs fine: signups are auto-verified and the verification link is logged to
# the backend console instead of emailed.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER


# ============================================================
# Central user tracking (Supabase REST)
#
# Each self-hosted instance reports new signups to ONE shared Supabase table
# via its REST API, using the PUBLISHABLE (anon) key. That key is safe to ship
# inside the image: it is public by design and the table is locked down with an
# INSERT-only Row Level Security policy, so a leaked key can at most add a
# signup row — never read, edit, or delete anyone's data. The powerful Postgres
# password / service_role key is NEVER shipped.
#
# In published images these two values are baked in via the Dockerfile (ENV).
# Leave both empty to disable central tracking entirely (the app still works).
# ============================================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")

# Optional label so you can tell which deployment a signup came from.
APP_INSTANCE_ID = os.getenv("APP_INSTANCE_ID", "") or os.getenv("HOSTNAME", "unknown")

# How often (seconds) the background retry loop re-attempts any signups that
# haven't been confirmed as pushed to Supabase yet (e.g. Supabase was down).
TRACKING_RETRY_INTERVAL = int(os.getenv("TRACKING_RETRY_INTERVAL", "120"))
