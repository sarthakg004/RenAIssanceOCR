"""
Shared API dependencies — API key header extraction.
"""

from fastapi import Header


async def get_gemini_api_key(
    x_gemini_api_key: str = Header(..., alias="X-Gemini-API-Key")
) -> str:
    """Extract Gemini API key from header."""
    return x_gemini_api_key


async def get_api_key(
    x_api_key: str = Header(..., alias="X-API-Key")
) -> str:
    """Extract generic provider API key from header."""
    return x_api_key
