"""
Gemini LLM client for OCR text post-processing.

Uses the same google-genai SDK pattern as the OCR Gemini provider.
"""

from google import genai

from .prompt_templates import get_template


# Models suitable for text post-processing (fast + cheap)
DEFAULT_MODEL = "gemini-2.5-flash"


def post_process_text(
    api_key: str,
    text: str,
    model: str = DEFAULT_MODEL,
    template_name: str = "full_cleanup",
) -> str:
    """
    Send OCR text to Gemini for post-processing / cleanup.

    Args:
        api_key: Gemini API key
        text: Raw OCR text to improve
        model: Gemini model ID
        template_name: Key from prompt_templates.TEMPLATES

    Returns:
        Improved text string

    Raises:
        Exception on API errors (auth, rate limit, empty response)
    """
    if not text or not text.strip():
        return text

    client = genai.Client(api_key=api_key)
    prompt = get_template(template_name) + text

    response = client.models.generate_content(
        model=model,
        contents=[prompt],
    )

    result = response.text
    if not result or not result.strip():
        raise ValueError("LLM returned an empty response")

    return result.strip()
