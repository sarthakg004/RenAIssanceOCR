"""
Gemini OCR Provider — uses Google GenAI SDK.
"""

from google import genai
from google.genai import types

from .base import BaseOCRProvider
from ...utils.prompt import OCR_PROMPT


AVAILABLE_MODELS = [
    {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview",
        "description": "Latest and fastest preview model (recommended)"
    },
    {
        "id": "gemini-3-pro-preview",
        "name": "Gemini 3 Pro Preview",
        "description": "Most capable preview model for complex documents"
    },
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro",
        "description": "Stable pro model, excellent accuracy"
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "description": "Stable flash model, good balance of speed and quality"
    },
]

DEFAULT_MODEL = "gemini-3-flash-preview"
MODEL_IDS = [m["id"] for m in AVAILABLE_MODELS]


def get_gemini_client(api_key: str):
    """Create Gemini client with provided API key"""
    return genai.Client(api_key=api_key)


class GeminiProvider(BaseOCRProvider):
    """Gemini OCR provider using Google GenAI SDK."""

    MODELS = AVAILABLE_MODELS
    DEFAULT_MODEL = DEFAULT_MODEL
    MODEL_IDS = MODEL_IDS

    def transcribe(self, api_key: str, image_bytes: bytes, model_name: str, mime_type: str = "image/png") -> str:
        client = get_gemini_client(api_key)
        response = client.models.generate_content(
            model=model_name,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                OCR_PROMPT
            ],
        )
        return response.text
