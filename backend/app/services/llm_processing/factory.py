"""
LLM post-processing provider registry + dispatch.

Mirrors the Strategy/Factory pattern used by app/services/ocr/factory.py, but
for text→text cleanup instead of image OCR. Gemini goes through the google-genai
SDK (gemini_client); OpenAI / DeepSeek / Qwen share the OpenAI-compatible
chat-completions client (openai_compat_client).

`local_es` is registered but disabled — it is the placeholder for the
Spanish-finetuned local model that will be wired in later. It surfaces in the
UI as a disabled option so the toggle/flow can be built and tested now.
"""

from .gemini_client import post_process_text as _gemini_post_process
from .openai_compat_client import post_process_text_openai_compat


# OpenAI-compatible chat-completions endpoints (same URLs as the OCR providers).
_OPENAI_COMPAT_ENDPOINTS = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/v1/chat/completions",
    "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
}


# Provider metadata consumed by the frontend (GET /api/llm/providers) to
# populate the provider/model dropdowns. Models here are TEXT models suited to
# post-processing — note Qwen uses the qwen-plus/turbo/max text line, not the
# qwen-vl-* vision models used for OCR.
LLM_PROVIDERS = [
    {
        "id": "gemini",
        "name": "Gemini",
        "enabled": True,
        "default_model": "gemini-2.5-flash",
        "models": [
            {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
            {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro"},
        ],
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "enabled": True,
        "default_model": "gpt-5-mini",
        "models": [
            {"id": "gpt-5-mini", "name": "GPT-5 Mini"},
            {"id": "gpt-5.2", "name": "GPT-5.2"},
        ],
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "enabled": True,
        "default_model": "deepseek-chat",
        "models": [
            {"id": "deepseek-chat", "name": "DeepSeek Chat"},
            {"id": "deepseek-reasoner", "name": "DeepSeek Reasoner"},
        ],
    },
    {
        "id": "qwen",
        "name": "Qwen",
        "enabled": True,
        "default_model": "qwen-plus",
        "models": [
            {"id": "qwen-plus", "name": "Qwen Plus"},
            {"id": "qwen-turbo", "name": "Qwen Turbo"},
            {"id": "qwen-max", "name": "Qwen Max"},
        ],
    },
    {
        "id": "local_es",
        "name": "Local fine-tuned (Spanish)",
        "enabled": False,
        "default_model": None,
        "models": [],
        "note": "Coming soon — fine-tuned on Spanish historical data.",
    },
]

_ENABLED_PROVIDER_IDS = {p["id"] for p in LLM_PROVIDERS if p["enabled"]}


def post_process(
    provider: str,
    api_key: str,
    text: str,
    model: str,
    template_name: str = "full_cleanup",
) -> str:
    """
    Dispatch a post-processing request to the requested provider.

    Raises:
        ValueError: unknown or not-yet-enabled provider
        Exception:  propagated provider/API errors
    """
    provider = (provider or "gemini").lower()

    if provider not in _ENABLED_PROVIDER_IDS:
        if any(p["id"] == provider for p in LLM_PROVIDERS):
            raise ValueError(
                f"Provider '{provider}' is not available yet."
            )
        valid = ", ".join(sorted(_ENABLED_PROVIDER_IDS))
        raise ValueError(
            f"Unknown LLM provider: '{provider}'. Valid providers: {valid}"
        )

    if provider == "gemini":
        return _gemini_post_process(api_key, text, model, template_name)

    return post_process_text_openai_compat(
        endpoint=_OPENAI_COMPAT_ENDPOINTS[provider],
        api_key=api_key,
        text=text,
        model=model,
        template_name=template_name,
    )
