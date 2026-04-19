"""
LLM Post-processing API Router — optional text cleanup using Gemini.
"""

import traceback
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..services.llm_processing.gemini_client import post_process_text
from ..services.llm_processing.prompt_templates import list_templates


router = APIRouter(prefix="/api/llm", tags=["llm"])


# ── Schemas ─────────────────────────────────────────────────────────

class PostProcessRequest(BaseModel):
    text: str
    model: str = "gemini-2.5-flash"
    template: str = "full_cleanup"


class PostProcessResponse(BaseModel):
    success: bool
    processed_text: Optional[str] = None
    error: Optional[str] = None
    model_used: Optional[str] = None


# ── Endpoints ───────────────────────────────────────────────────────

@router.get("/templates")
async def get_templates():
    """List available post-processing prompt templates."""
    return {"templates": list_templates()}


@router.post("/post-process", response_model=PostProcessResponse)
async def post_process_endpoint(
    request: PostProcessRequest,
    x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key"),
):
    """
    Post-process OCR text using a Gemini LLM.

    Reuses the same X-Gemini-API-Key header as the OCR endpoints.
    """
    if not request.text or not request.text.strip():
        return PostProcessResponse(
            success=True,
            processed_text=request.text,
            model_used=request.model,
        )

    try:
        result = post_process_text(
            api_key=x_gemini_api_key,
            text=request.text,
            model=request.model,
            template_name=request.template,
        )
        return PostProcessResponse(
            success=True,
            processed_text=result,
            model_used=request.model,
        )
    except Exception as e:
        traceback.print_exc()
        error_msg = str(e)
        # Detect common error types for better frontend messaging
        error_lower = error_msg.lower()
        if "api key" in error_lower or "authenticate" in error_lower or "401" in error_lower:
            return PostProcessResponse(success=False, error="Invalid API key")
        if "quota" in error_lower or "rate" in error_lower or "429" in error_lower:
            return PostProcessResponse(success=False, error="Rate limited — please try again later")
        return PostProcessResponse(success=False, error=error_msg)
