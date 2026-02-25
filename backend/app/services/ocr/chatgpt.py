"""
ChatGPT (OpenAI) OCR Provider — uses httpx to call OpenAI API.
"""

import base64
import httpx

from .base import BaseOCRProvider
from ...utils.prompt import OCR_PROMPT


CHATGPT_MODELS = [
    {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "description": "Most capable multimodal model, excellent OCR accuracy"
    },
    {
        "id": "gpt-4.1",
        "name": "GPT-4.1",
        "description": "Latest GPT-4.1 model with improved performance"
    },
    {
        "id": "gpt-4-turbo",
        "name": "GPT-4 Turbo",
        "description": "Fast GPT-4 with vision capabilities"
    },
    {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini",
        "description": "Smaller, faster, and more affordable"
    },
]

CHATGPT_MODEL_IDS = [m["id"] for m in CHATGPT_MODELS]
CHATGPT_DEFAULT_MODEL = "gpt-4o"


class ChatGPTProvider(BaseOCRProvider):
    """ChatGPT OCR provider using OpenAI API."""

    MODELS = CHATGPT_MODELS
    DEFAULT_MODEL = CHATGPT_DEFAULT_MODEL
    MODEL_IDS = CHATGPT_MODEL_IDS

    def transcribe(self, api_key: str, image_bytes: bytes, model_name: str, mime_type: str = "image/png") -> str:
        """Perform OCR using OpenAI ChatGPT API with vision"""
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        data_url = f"data:{mime_type};base64,{image_b64}"

        payload = {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url}
                        },
                        {
                            "type": "text",
                            "text": OCR_PROMPT
                        }
                    ]
                }
            ],
            "max_tokens": 4096,
        }

        response = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120.0,
        )
        response.raise_for_status()
        result = response.json()
        return result["choices"][0]["message"]["content"]
