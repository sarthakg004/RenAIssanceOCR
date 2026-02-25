"""
OCR API Router — all OCR-related endpoints.

Preserves all original endpoint paths, request shapes, and response formats.
"""

import time
import base64
import asyncio
from fastapi import APIRouter, File, UploadFile, HTTPException, Header, Form, Depends
import httpx

from ..schemas.ocr import (
    OCRResponse, OCRRequest,
    BatchOCRItem, BatchOCRRequest, BatchOCRResultItem, BatchOCRResponse,
    ChatGPTOCRRequest, DeepSeekOCRRequest, QwenOCRRequest,
)
from ..core.rate_limiter import rate_limiter
from ..services.ocr.gemini import (
    AVAILABLE_MODELS, DEFAULT_MODEL, MODEL_IDS, get_gemini_client, GeminiProvider,
)
from ..services.ocr.chatgpt import CHATGPT_MODELS, CHATGPT_MODEL_IDS, CHATGPT_DEFAULT_MODEL, ChatGPTProvider
from ..services.ocr.deepseek import DEEPSEEK_MODELS, DEEPSEEK_MODEL_IDS, DEEPSEEK_DEFAULT_MODEL, DeepSeekProvider
from ..services.ocr.qwen import QWEN_MODELS, QWEN_MODEL_IDS, QWEN_DEFAULT_MODEL, QwenProvider
from ..utils.prompt import OCR_PROMPT
from ..api.deps import get_gemini_api_key, get_api_key


router = APIRouter()


# ============================================
# Gemini Endpoints
# ============================================

@router.get("/api/models")
async def get_available_models():
    """Get list of available Gemini models"""
    return {
        "models": AVAILABLE_MODELS,
        "default": DEFAULT_MODEL
    }


@router.post("/api/validate-key")
async def validate_api_key(x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key")):
    """
    Validate a Gemini API key format.

    Note: We do NOT make an API call to validate the key because:
    1. It wastes quota (rate limits)
    2. The key will be validated on first actual OCR request
    3. Rate limit errors would falsely mark valid keys as invalid

    We only check the format here. The actual validation happens
    when processing pages - if the key is invalid, that call will fail.
    """
    if not x_gemini_api_key:
        raise HTTPException(status_code=401, detail="API key is required")

    # Gemini API keys typically start with 'AI' and are ~39 characters
    # But we'll be lenient and just check minimum length
    if len(x_gemini_api_key) < 20:
        raise HTTPException(status_code=401, detail="API key appears too short")

    # Format looks valid - actual validation will happen on first OCR call
    return {
        "valid": True,
        "message": "API key format is valid. It will be verified on first use."
    }


@router.get("/api/rate-limit-status")
async def get_rate_limit_status():
    """Get current rate limit status"""
    return rate_limiter.get_status()


@router.post("/api/gemini-ocr-page", response_model=OCRResponse)
async def ocr_page(
    image: UploadFile = File(...),
    model: str = Form(default=DEFAULT_MODEL),
    x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key")
):
    """
    Process a single page image with Gemini OCR

    Headers:
        X-Gemini-API-Key: Your Gemini API key

    Form Data:
        image: Image file to process
        model: Gemini model name (optional, defaults to gemini-2.0-flash)
    """
    # Check rate limit
    can_proceed, wait_time = rate_limiter.can_proceed()
    if not can_proceed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Rate limit exceeded. Please wait {wait_time} seconds.",
                "wait_seconds": wait_time
            }
        )

    # Validate model
    if model not in MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {MODEL_IDS}"
        )

    # Validate API key
    if not x_gemini_api_key or len(x_gemini_api_key) < 10:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing Gemini API key"
        )

    start_time = time.time()

    try:
        # Read image
        image_bytes = await image.read()

        # Determine MIME type
        content_type = image.content_type or "image/png"
        if content_type not in ["image/png", "image/jpeg", "image/jpg", "image/webp"]:
            content_type = "image/png"

        # Create provider and perform OCR
        provider = GeminiProvider()
        transcript = provider.transcribe(x_gemini_api_key, image_bytes, model, content_type)

        # Record successful request for rate limiting
        rate_limiter.record_request()

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=model,
            processing_time_ms=processing_time
        )

    except Exception as e:
        error_msg = str(e)

        # Check for specific API errors
        if "API_KEY_INVALID" in error_msg or "401" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid Gemini API key")
        if "QUOTA_EXCEEDED" in error_msg or "429" in error_msg:
            raise HTTPException(status_code=429, detail="Gemini API quota exceeded")

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=model,
            processing_time_ms=processing_time
        )


@router.post("/api/gemini-ocr-base64", response_model=OCRResponse)
async def ocr_page_base64(
    image_data: str = Form(...),
    model: str = Form(default=DEFAULT_MODEL),
    x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key")
):
    """
    Process a base64-encoded image with Gemini OCR

    Headers:
        X-Gemini-API-Key: Your Gemini API key

    Form Data:
        image_data: Base64 encoded image (with or without data URL prefix)
        model: Gemini model name
    """
    # Check rate limit
    can_proceed, wait_time = rate_limiter.can_proceed()
    if not can_proceed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Rate limit exceeded. Please wait {wait_time} seconds.",
                "wait_seconds": wait_time
            }
        )

    # Validate model
    if model not in MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {MODEL_IDS}"
        )

    start_time = time.time()

    try:
        # Parse base64 data
        if "," in image_data:
            # Has data URL prefix like "data:image/png;base64,..."
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        image_bytes = base64.b64decode(encoded)

        # Create provider and perform OCR
        provider = GeminiProvider()
        transcript = provider.transcribe(x_gemini_api_key, image_bytes, model, mime_type)

        # Record successful request
        rate_limiter.record_request()

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=model,
            processing_time_ms=processing_time
        )

    except Exception as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        if "API_KEY_INVALID" in error_msg or "401" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid Gemini API key")

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=model,
            processing_time_ms=processing_time
        )


@router.post("/api/gemini-ocr-json", response_model=OCRResponse)
async def ocr_page_json(
    request: OCRRequest,
    x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key")
):
    """
    Process a base64-encoded image with Gemini OCR (JSON body)

    This endpoint uses JSON body instead of FormData, which allows for
    larger image uploads (up to 100MB) without hitting multipart size limits.

    Headers:
        X-Gemini-API-Key: Your Gemini API key

    JSON Body:
        image_data: Base64 encoded image (with or without data URL prefix)
        model: Gemini model name
    """
    # Check rate limit
    can_proceed, wait_time = rate_limiter.can_proceed()
    if not can_proceed:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Rate limit exceeded. Please wait {wait_time} seconds.",
                "wait_seconds": wait_time
            }
        )

    # Validate model
    if request.model not in MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {MODEL_IDS}"
        )

    start_time = time.time()

    try:
        image_data = request.image_data

        # Parse base64 data
        if "," in image_data:
            # Has data URL prefix like "data:image/png;base64,..."
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        image_bytes = base64.b64decode(encoded)

        # Create provider and perform OCR
        provider = GeminiProvider()
        transcript = provider.transcribe(x_gemini_api_key, image_bytes, request.model, mime_type)

        # Record successful request
        rate_limiter.record_request()

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except Exception as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        if "API_KEY_INVALID" in error_msg or "401" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid Gemini API key")

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )


# ============================================
# Batch OCR Endpoint - Process multiple pages concurrently
# ============================================

async def process_single_ocr(
    provider: GeminiProvider,
    api_key: str,
    item: BatchOCRItem,
    model: str
) -> BatchOCRResultItem:
    """Process a single OCR request (for concurrent execution)"""
    start_time = time.time()

    try:
        image_data = item.image_data

        # Parse base64 data
        if "," in image_data:
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        image_bytes = base64.b64decode(encoded)

        # Perform OCR (run in thread pool since it's blocking)
        transcript = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: provider.transcribe(api_key, image_bytes, model, mime_type)
        )

        processing_time = int((time.time() - start_time) * 1000)

        return BatchOCRResultItem(
            page_index=item.page_index,
            success=True,
            transcript=transcript,
            processing_time_ms=processing_time
        )

    except Exception as e:
        processing_time = int((time.time() - start_time) * 1000)
        return BatchOCRResultItem(
            page_index=item.page_index,
            success=False,
            error=str(e),
            processing_time_ms=processing_time
        )


@router.post("/api/gemini-ocr-batch", response_model=BatchOCRResponse)
async def ocr_batch(
    request: BatchOCRRequest,
    x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key")
):
    """
    Process multiple images with Gemini OCR concurrently.

    Supports up to 4 images per batch to stay within rate limits (5 req/min).
    This allows processing 4 pages at once instead of waiting 12 seconds between each.

    Headers:
        X-Gemini-API-Key: Your Gemini API key

    JSON Body:
        items: Array of {page_index, image_data} objects
        model: Gemini model name
    """
    MAX_BATCH_SIZE = 4

    # Limit batch size
    if len(request.items) > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Batch size exceeds maximum of {MAX_BATCH_SIZE}. Got {len(request.items)} items."
        )

    if len(request.items) == 0:
        raise HTTPException(status_code=400, detail="Empty batch request")

    # Check rate limit - need enough slots for all items
    available_slots = rate_limiter.get_available_slots()
    if available_slots < len(request.items):
        status = rate_limiter.get_status()
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": f"Not enough rate limit slots. Need {len(request.items)}, have {available_slots}.",
                "wait_seconds": status.get("wait_seconds", 60),
                "available_slots": available_slots
            }
        )

    # Validate model
    if request.model not in MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {MODEL_IDS}"
        )

    start_time = time.time()

    try:
        # Create provider once for all requests
        provider = GeminiProvider()

        # Process all items concurrently
        tasks = [
            process_single_ocr(provider, x_gemini_api_key, item, request.model)
            for item in request.items
        ]
        results = await asyncio.gather(*tasks)

        # Record all requests
        rate_limiter.record_requests(len(request.items))

        total_time = int((time.time() - start_time) * 1000)
        successful = sum(1 for r in results if r.success)
        failed = len(results) - successful

        return BatchOCRResponse(
            results=results,
            total_processing_time_ms=total_time,
            successful_count=successful,
            failed_count=failed
        )

    except Exception as e:
        error_msg = str(e)
        if "API_KEY_INVALID" in error_msg or "401" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid Gemini API key")
        raise HTTPException(status_code=500, detail=error_msg)


# ============================================
# ChatGPT Endpoints
# ============================================

@router.get("/api/chatgpt-models")
async def get_chatgpt_models():
    """Get list of available ChatGPT models"""
    return {
        "models": CHATGPT_MODELS,
        "default": CHATGPT_DEFAULT_MODEL
    }


@router.post("/api/chatgpt-ocr-json", response_model=OCRResponse)
async def chatgpt_ocr_page(
    request: ChatGPTOCRRequest,
    x_api_key: str = Header(..., alias="X-API-Key")
):
    """
    Process a base64-encoded image with ChatGPT OCR (JSON body)

    Headers:
        X-API-Key: Your OpenAI API key

    JSON Body:
        image_data: Base64 encoded image (with or without data URL prefix)
        model: ChatGPT model name
    """
    # Validate model
    if request.model not in CHATGPT_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {CHATGPT_MODEL_IDS}"
        )

    start_time = time.time()

    try:
        image_data = request.image_data

        # Parse base64 data
        if "," in image_data:
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        image_bytes = base64.b64decode(encoded)

        # Perform OCR
        provider = ChatGPTProvider()
        transcript = provider.transcribe(x_api_key, image_bytes, request.model, mime_type)

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except httpx.HTTPStatusError as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        if e.response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid OpenAI API key")
        if e.response.status_code == 429:
            raise HTTPException(status_code=429, detail="OpenAI API rate limit exceeded")

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except Exception as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )


# ============================================
# DeepSeek Endpoints
# ============================================

@router.get("/api/deepseek-models")
async def get_deepseek_models():
    """Get list of available DeepSeek models"""
    return {
        "models": DEEPSEEK_MODELS,
        "default": DEEPSEEK_DEFAULT_MODEL
    }


@router.post("/api/deepseek-ocr-json", response_model=OCRResponse)
async def deepseek_ocr_page(
    request: DeepSeekOCRRequest,
    x_api_key: str = Header(..., alias="X-API-Key")
):
    """
    Process a base64-encoded image with DeepSeek OCR (JSON body)

    Headers:
        X-API-Key: Your DeepSeek API key

    JSON Body:
        image_data: Base64 encoded image (with or without data URL prefix)
        model: DeepSeek model name
    """
    # Validate model
    if request.model not in DEEPSEEK_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {DEEPSEEK_MODEL_IDS}"
        )

    start_time = time.time()

    try:
        image_data = request.image_data

        # Parse base64 data
        if "," in image_data:
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        image_bytes = base64.b64decode(encoded)

        # Perform OCR
        provider = DeepSeekProvider()
        transcript = provider.transcribe(x_api_key, image_bytes, request.model, mime_type)

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except httpx.HTTPStatusError as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        if e.response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid DeepSeek API key")
        if e.response.status_code == 429:
            raise HTTPException(status_code=429, detail="DeepSeek API rate limit exceeded")

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except Exception as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )


# ============================================
# Qwen Endpoints
# ============================================

@router.get("/api/qwen-models")
async def get_qwen_models():
    """Get list of available Qwen models"""
    return {
        "models": QWEN_MODELS,
        "default": QWEN_DEFAULT_MODEL
    }


@router.post("/api/qwen-ocr-json", response_model=OCRResponse)
async def qwen_ocr_page(
    request: QwenOCRRequest,
    x_api_key: str = Header(..., alias="X-API-Key")
):
    """
    Process a base64-encoded image with Qwen OCR (JSON body)

    Headers:
        X-API-Key: Your DashScope/Qwen API key

    JSON Body:
        image_data: Base64 encoded image (with or without data URL prefix)
        model: Qwen model name
    """
    # Validate model
    if request.model not in QWEN_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {QWEN_MODEL_IDS}"
        )

    start_time = time.time()

    try:
        image_data = request.image_data

        # Parse base64 data
        if "," in image_data:
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        image_bytes = base64.b64decode(encoded)

        # Perform OCR
        provider = QwenProvider()
        transcript = provider.transcribe(x_api_key, image_bytes, request.model, mime_type)

        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except httpx.HTTPStatusError as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        if e.response.status_code == 401:
            raise HTTPException(status_code=401, detail="Invalid Qwen/DashScope API key")
        if e.response.status_code == 429:
            raise HTTPException(status_code=429, detail="Qwen API rate limit exceeded")

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )

    except Exception as e:
        error_msg = str(e)
        processing_time = int((time.time() - start_time) * 1000)

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=request.model,
            processing_time_ms=processing_time
        )
