"""
Gemini OCR Provider — uses Google GenAI SDK.
"""

import time

from google import genai
from google.genai import types
from google.genai import errors as genai_errors
from typing import Optional

from .base import BaseOCRProvider
from ...utils.prompt import OCR_PROMPT

# Gemini often returns transient 503 "high demand" / 500 errors. They usually
# clear in a second or two, so retry with backoff before giving up. 4xx errors
# (bad key, invalid model, daily quota) are NOT retried — they won't clear.
_MAX_RETRIES = 2
_RETRY_BACKOFF_S = (2,)


AVAILABLE_MODELS = [
    {
        "id": "gemini-3.1-flash-lite",
        "name": "Gemini 3.1 Flash Lite",
        "description": "Fast and light, best free-tier quota (recommended)"
    },
    {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash",
        "description": "Fast, high quality for most documents"
    },
    {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash",
        "description": "Higher quality, good balance of speed and accuracy"
    },
    {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro",
        "description": "Most capable, best for hard pages (low daily quota)"
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "description": "Stable fallback when 3.x models are busy"
    },
]

DEFAULT_MODEL = "gemini-3.1-flash-lite"
MODEL_IDS = [m["id"] for m in AVAILABLE_MODELS]

# Match the other providers' request timeout so a slow/thinking call can't
# hang forever (and silently burn free-tier quota) with no response.
REQUEST_TIMEOUT_MS = 120_000


def get_gemini_client(api_key: str):
    """Create Gemini client with provided API key"""
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
    )


class GeminiProvider(BaseOCRProvider):
    """Gemini OCR provider using Google GenAI SDK."""

    MODELS = AVAILABLE_MODELS
    DEFAULT_MODEL = DEFAULT_MODEL
    MODEL_IDS = MODEL_IDS

    def _generate(self, client, model_name: str, image_bytes: bytes, mime_type: str, prompt: str):
        """One generation with retry-on-5xx (503 'high demand' is transient)."""
        # Gemini 3 models "think" by default and can spend the token budget
        # reasoning — returning no text on a dense page image. OCR wants
        # transcription, not reasoning, so cap the thinking. `thinking_level`
        # only exists in newer google-genai SDKs; the pinned one lacks it, so
        # guard on the field and skip the config where unsupported.
        config = None
        if model_name.startswith("gemini-3") and "thinking_level" in types.ThinkingConfig.model_fields:
            config = types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_level="low")
            )

        for attempt in range(_MAX_RETRIES):
            try:
                return client.models.generate_content(
                    model=model_name,
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        prompt
                    ],
                    config=config,
                )
            except genai_errors.ServerError:
                if attempt >= _MAX_RETRIES - 1:
                    raise
                time.sleep(_RETRY_BACKOFF_S[attempt])

    def transcribe(self, api_key: str, image_bytes: bytes, model_name: str, mime_type: str = "image/png", custom_prompt: Optional[str] = None) -> str:
        client = get_gemini_client(api_key)
        prompt = custom_prompt if custom_prompt else OCR_PROMPT

        response = self._generate(client, model_name, image_bytes, mime_type, prompt)

        text = response.text
        if not text:
            # Thinking models can finish with no text part (all budget spent
            # thinking, or output blocked). Surface why instead of returning
            # an empty string the UI would show as a blank transcription.
            reason = getattr(response, "prompt_feedback", None) or getattr(
                response, "candidates", None
            )
            raise ValueError(f"Gemini returned no text (finish info: {reason})")
        return text
