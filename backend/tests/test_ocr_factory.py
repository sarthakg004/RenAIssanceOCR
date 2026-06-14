"""OCRFactory strategy/registry behavior (no network — only construction)."""

import pytest

from app.services.ocr.base import BaseOCRProvider
from app.services.ocr.factory import OCRFactory


def test_list_providers_contains_all():
    names = set(OCRFactory.list_providers())
    assert {"gemini", "chatgpt", "deepseek", "qwen"} <= names


@pytest.mark.parametrize("name", ["gemini", "chatgpt", "deepseek", "qwen", "GEMINI"])
def test_get_provider_returns_base_instance(name):
    provider = OCRFactory.get_provider(name)
    assert isinstance(provider, BaseOCRProvider)


def test_unknown_provider_raises_valueerror():
    with pytest.raises(ValueError):
        OCRFactory.get_provider("not-a-real-provider")
