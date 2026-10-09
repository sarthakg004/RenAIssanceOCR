"""ChatGPT, DeepSeek and Qwen: one OpenAI-compatible chat-completions call, three endpoints."""

import base64
from typing import Optional

import httpx

from .base import BaseOCRProvider
from ...utils.prompt import OCR_PROMPT


def _models(*rows: tuple[str, str, str]) -> list[dict]:
    return [{"id": i, "name": name, "description": desc} for i, name, desc in rows]


class OpenAICompatibleProvider(BaseOCRProvider):
    """Vision OCR over any /chat/completions endpoint that accepts image_url message parts."""

    ENDPOINT: str = ""

    def transcribe(self, api_key: str, image_bytes: bytes, model_name: str, mime_type: str = "image/png",
                   custom_prompt: Optional[str] = None) -> str:
        image = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('utf-8')}"
        response = httpx.post(
            self.ENDPOINT,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model_name, "max_tokens": 4096, "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image}},
                {"type": "text", "text": custom_prompt or OCR_PROMPT},
            ]}]},
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


class ChatGPTProvider(OpenAICompatibleProvider):
    ENDPOINT = "https://api.openai.com/v1/chat/completions"
    MODELS = _models(("gpt-5.2", "GPT-5.2", "Latest and most capable multimodal model"),
                     ("gpt-5-mini", "GPT-5 Mini", "Smaller, faster, and more affordable"))
    DEFAULT_MODEL = "gpt-5.2"


class DeepSeekProvider(OpenAICompatibleProvider):
    ENDPOINT = "https://api.deepseek.com/v1/chat/completions"
    MODELS = _models(("deepseek-chat", "DeepSeek Chat", "DeepSeek general chat model"),
                     ("deepseek-reasoner", "DeepSeek Reasoner", "DeepSeek reasoning model"))
    DEFAULT_MODEL = "deepseek-chat"


class QwenProvider(OpenAICompatibleProvider):
    ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    MODELS = _models(("qwen-vl-max", "Qwen VL Max", "Most capable Qwen vision-language model"),
                     ("qwen-vl-ocr", "Qwen VL OCR", "Qwen model optimized for OCR tasks"),
                     ("qwen2.5-vl-72b-instruct", "Qwen2.5 VL 72B", "Large Qwen 2.5 vision-language model"),
                     ("qwen2.5-vl-7b-instruct", "Qwen2.5 VL 7B", "Efficient Qwen 2.5 vision model"))
    DEFAULT_MODEL = "qwen-vl-max"
