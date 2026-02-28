"""
Shared helpers for OCR endpoints — base64 parsing, model validation,
rate-limit checks, and a unified OCR execution wrapper.

All provider endpoints delegate to these helpers so that validation,
error handling, and response formatting are defined in one place.
"""

import base64
import time

from fastapi import HTTPException

try:
    import httpx
except ImportError:  # httpx is optional for Gemini-only setups
    httpx = None  # type: ignore

from ..core.rate_limiter import rate_limiter
from ..schemas.ocr import OCRResponse
from ..services.ocr.base import BaseOCRProvider


# ── Base64 parsing ──────────────────────────────────────────────


def parse_base64_image(image_data: str) -> tuple[bytes, str]:
    """
    Decode a base64-encoded image string.

    Handles both raw base64 and ``data:<mime>;base64,...`` prefixed strings.

    Returns:
        (image_bytes, mime_type)
    """
    if "," in image_data:
        header, encoded = image_data.split(",", 1)
        mime_type = (
            header.split(":")[1].split(";")[0]
            if ":" in header
            else "image/png"
        )
    else:
        encoded = image_data
        mime_type = "image/png"

    return base64.b64decode(encoded), mime_type


# ── Validation helpers ──────────────────────────────────────────


def validate_model(model: str, valid_ids: list[str]) -> None:
    """Raise *400 Bad Request* if *model* is not in the valid list."""
    if model not in valid_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model. Available models: {valid_ids}",
        )


def validate_api_key_format(api_key: str, min_length: int = 10) -> None:
    """Raise *401 Unauthorized* if the API key is missing or too short."""
    if not api_key or len(api_key) < min_length:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key",
        )


# ── Rate-limit helpers ──────────────────────────────────────────


def check_rate_limit(required_slots: int = 1) -> None:
    """
    Check the sliding-window rate limiter.

    Raises *429 Too Many Requests* with a JSON detail body when there
    are not enough available slots.
    """
    if required_slots <= 1:
        can_proceed, wait_time = rate_limiter.can_proceed()
        if not can_proceed:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "message": f"Rate limit exceeded. Please wait {wait_time} seconds.",
                    "wait_seconds": wait_time,
                },
            )
    else:
        available = rate_limiter.get_available_slots()
        if available < required_slots:
            status = rate_limiter.get_status()
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "message": (
                        f"Not enough rate limit slots. "
                        f"Need {required_slots}, have {available}."
                    ),
                    "wait_seconds": status.get("wait_seconds", 60),
                    "available_slots": available,
                },
            )


# ── Unified OCR execution ──────────────────────────────────────


def run_ocr(
    provider: BaseOCRProvider,
    api_key: str,
    image_bytes: bytes,
    model: str,
    mime_type: str,
) -> OCRResponse:
    """
    Call ``provider.transcribe`` and return a standardised ``OCRResponse``.

    Handles:
    • ``httpx.HTTPStatusError``  (ChatGPT / DeepSeek / Qwen providers)
    • Google-SDK errors          (Gemini provider)
    • Generic exceptions
    """
    start_time = time.time()

    try:
        transcript = provider.transcribe(api_key, image_bytes, model, mime_type)
        processing_time = int((time.time() - start_time) * 1000)
        return OCRResponse(
            success=True,
            transcript=transcript,
            model_used=model,
            processing_time_ms=processing_time,
        )

    except Exception as exc:
        processing_time = int((time.time() - start_time) * 1000)

        # Re-raise as HTTP errors for known auth / quota issues
        if httpx is not None and isinstance(exc, httpx.HTTPStatusError):
            if exc.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid API key")
            if exc.response.status_code == 429:
                raise HTTPException(
                    status_code=429, detail="API rate limit exceeded"
                )

        error_msg = str(exc)
        if "API_KEY_INVALID" in error_msg or "401" in error_msg:
            raise HTTPException(status_code=401, detail="Invalid API key")
        if "QUOTA_EXCEEDED" in error_msg or "429" in error_msg:
            raise HTTPException(status_code=429, detail="API quota exceeded")

        return OCRResponse(
            success=False,
            error=error_msg,
            model_used=model,
            processing_time_ms=processing_time,
        )
