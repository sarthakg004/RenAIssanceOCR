"""
Pydantic models for all API request/response schemas.
"""

from typing import Optional
from pydantic import BaseModel


# ============================================
# Gemini OCR Schemas
# ============================================

class OCRResponse(BaseModel):
    success: bool
    transcript: Optional[str] = None
    error: Optional[str] = None
    model_used: str
    processing_time_ms: int


class RateLimitResponse(BaseModel):
    ready: bool
    wait_seconds: int
    last_request: Optional[float]


class OCRRequest(BaseModel):
    """Request model for JSON-based OCR endpoint (supports large images)"""
    image_data: str  # Base64 encoded image with data URL prefix
    model: str = "gemini-3-flash-preview"


class ExportRequest(BaseModel):
    transcripts: dict  # {page_number: transcript_text}
    format: str  # "txt", "docx", "pdf"


class PreprocessRequest(BaseModel):
    """Request model for preprocessing endpoint"""
    image_data: str  # Base64 encoded image with data URL prefix
    operations: list  # List of {op, params, enabled} dicts
    preview_mode: bool = False  # Use faster algorithms for preview


# ============================================
# Batch OCR Schemas
# ============================================

class BatchOCRItem(BaseModel):
    """Single item in batch OCR request"""
    page_index: int
    image_data: str


class BatchOCRRequest(BaseModel):
    """Request body for batch OCR"""
    items: list[BatchOCRItem]
    model: str = "gemini-3-flash-preview"


class BatchOCRResultItem(BaseModel):
    """Single result from batch OCR"""
    page_index: int
    success: bool
    transcript: Optional[str] = None
    error: Optional[str] = None
    processing_time_ms: int = 0


class BatchOCRResponse(BaseModel):
    """Response from batch OCR"""
    results: list[BatchOCRResultItem]
    total_processing_time_ms: int
    successful_count: int
    failed_count: int


# ============================================
# ChatGPT OCR Schemas
# ============================================

class ChatGPTOCRRequest(BaseModel):
    """Request model for ChatGPT OCR endpoint"""
    image_data: str
    model: str = "gpt-4o"


# ============================================
# DeepSeek OCR Schemas
# ============================================

class DeepSeekOCRRequest(BaseModel):
    """Request model for DeepSeek OCR endpoint"""
    image_data: str
    model: str = "deepseek-chat"


# ============================================
# Qwen OCR Schemas
# ============================================

class QwenOCRRequest(BaseModel):
    """Request model for Qwen OCR endpoint"""
    image_data: str
    model: str = "qwen-vl-max"
