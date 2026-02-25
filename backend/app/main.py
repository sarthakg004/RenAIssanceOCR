"""
RenAIssance OCR Backend Server
FastAPI server for OCR text recognition using multiple AI providers.

New modular entrypoint — replaces monolithic main.py.
"""

import os
import sys

# Add backend directory to path for preprocessing module imports
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import APP_TITLE, APP_VERSION, CORS_ORIGINS
from .api.health import router as health_router
from .api.ocr import router as ocr_router
from .api.preprocess import router as preprocess_router
from .api.export import router as export_router

# Create FastAPI app
app = FastAPI(title=APP_TITLE, version=APP_VERSION)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router)
app.include_router(ocr_router)
app.include_router(preprocess_router)
app.include_router(export_router)


# ============================================
# Run Server
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
