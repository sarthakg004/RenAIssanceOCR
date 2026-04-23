"""
Application-wide configuration constants.
"""

import os


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
