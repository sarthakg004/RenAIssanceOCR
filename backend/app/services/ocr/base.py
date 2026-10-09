"""Interface every OCR provider implements."""

from abc import ABC, abstractmethod
from typing import Optional


class BaseOCRProvider(ABC):
    """An OCR engine that reads a whole page image. Subclasses set MODELS and DEFAULT_MODEL."""

    MODELS: list[dict] = []  # [{"id", "name", "description"}], shown in the UI
    DEFAULT_MODEL: str = ""

    @property
    def model_ids(self) -> list[str]:
        return [m["id"] for m in self.MODELS]

    @abstractmethod
    def transcribe(self, api_key: str, image_bytes: bytes, model_name: str, mime_type: str = "image/png",
                   custom_prompt: Optional[str] = None) -> str:
        """OCR the image and return the text. custom_prompt replaces utils.prompt.OCR_PROMPT."""
