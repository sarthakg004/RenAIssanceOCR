"""
Abstract Base Class for OCR Providers.
"""

from abc import ABC, abstractmethod
from typing import Optional


class BaseOCRProvider(ABC):
    """Base class for all OCR providers."""

    # Subclasses must define these
    MODELS: list = []
    DEFAULT_MODEL: str = ""
    MODEL_IDS: list = []

    @abstractmethod
    def transcribe(self, api_key: str, image_bytes: bytes, model_name: str, mime_type: str = "image/png", custom_prompt: Optional[str] = None) -> str:
        """
        Perform OCR on the given image bytes.

        Args:
            api_key: Provider API key
            image_bytes: Raw image bytes
            model_name: Model identifier
            mime_type: Image MIME type
            custom_prompt: Optional custom prompt to use instead of the system default

        Returns:
            Transcribed text string
        """
        ...
