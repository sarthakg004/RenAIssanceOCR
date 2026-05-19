"""
OpenAI-compatible LLM client for OCR text post-processing.

OpenAI, DeepSeek and Qwen (DashScope compatible-mode) all expose the same
`/chat/completions` schema, so a single text-only client serves all three —
mirroring the pattern already used by the OCR providers
(app/services/ocr/{chatgpt,deepseek,qwen}.py), but with plain-text message
content instead of an image payload.
"""

import httpx

from .prompt_templates import get_template


def post_process_text_openai_compat(
    endpoint: str,
    api_key: str,
    text: str,
    model: str,
    template_name: str = "full_cleanup",
) -> str:
    """
    Post-process OCR text via an OpenAI-compatible chat completions endpoint.

    Args:
        endpoint: Full chat-completions URL for the provider
        api_key: Provider API key (Bearer auth)
        text: Raw OCR text to improve
        model: Model identifier
        template_name: Key from prompt_templates.TEMPLATES

    Returns:
        Improved text string

    Raises:
        Exception on API errors (auth, rate limit, empty response)
    """
    if not text or not text.strip():
        return text

    prompt = get_template(template_name) + text

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        # Matches the OCR providers' cap; post-processing output is roughly the
        # same length as the input page, so 4096 is comfortably sufficient.
        "max_tokens": 4096,
    }

    response = httpx.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120.0,
    )
    response.raise_for_status()
    result = response.json()["choices"][0]["message"]["content"]

    if not result or not result.strip():
        raise ValueError("LLM returned an empty response")

    return result.strip()
