"""
Application-wide configuration constants.
"""

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
