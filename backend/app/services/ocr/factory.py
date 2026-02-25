"""
OCR Provider Factory — returns the correct provider by name.
"""

from .base import BaseOCRProvider
from .gemini import GeminiProvider
from .chatgpt import ChatGPTProvider
from .deepseek import DeepSeekProvider
from .qwen import QwenProvider


# Registry of provider name → class
_PROVIDERS = {
    "gemini": GeminiProvider,
    "chatgpt": ChatGPTProvider,
    "deepseek": DeepSeekProvider,
    "qwen": QwenProvider,
}


class OCRFactory:
    """Factory for creating OCR provider instances."""

    @staticmethod
    def get_provider(name: str) -> BaseOCRProvider:
        """
        Get an OCR provider by name.

        Args:
            name: Provider name (gemini, chatgpt, deepseek, qwen)

        Returns:
            An instance of the requested provider

        Raises:
            ValueError: If provider name is unknown
        """
        provider_cls = _PROVIDERS.get(name.lower())
        if provider_cls is None:
            valid = ", ".join(_PROVIDERS.keys())
            raise ValueError(f"Unknown OCR provider: '{name}'. Valid providers: {valid}")
        return provider_cls()

    @staticmethod
    def list_providers() -> list[str]:
        """List all available provider names."""
        return list(_PROVIDERS.keys())
