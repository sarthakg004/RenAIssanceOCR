"""
Application-wide configuration constants.
"""

# FastAPI app metadata
APP_TITLE = "Gemini OCR API"
APP_VERSION = "1.0.0"

# CORS origins allowed by the backend
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
]

# Increase max upload size to 100MB (Gemini supports up to 100MB images)
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100MB in bytes
