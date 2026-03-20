"""TrOCR recognizer for line-level OCR inference."""

from __future__ import annotations

import gc
import logging
import os
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

logger = logging.getLogger(__name__)


def discover_models(search_dir: str) -> list[dict]:
    """Discover TrOCR checkpoints from local HuggingFace-style directories."""
    models: list[dict] = []
    root = Path(search_dir)
    if not root.is_dir():
        logger.warning("TrOCR model search directory does not exist: %s", search_dir)
        return models

    for dirpath, _dirnames, filenames in os.walk(root):
        files = set(filenames)
        if "config.json" not in files:
            continue
        has_weights = "model.safetensors" in files or "pytorch_model.bin" in files
        if not has_weights:
            continue

        abs_dir = os.path.abspath(dirpath)
        rel = os.path.relpath(abs_dir, root)
        display_name = rel.replace(os.sep, " / ") if rel != "." else Path(abs_dir).name
        model_id = f"trocr:{rel.replace(os.sep, '/')}" if rel != "." else "trocr:default"
        models.append(
            {
                "id": model_id,
                "name": f"TrOCR - {display_name}",
                "model_type": "trocr",
                "path": abs_dir,
            }
        )

    return sorted(models, key=lambda item: item["name"].lower())


def crop_polygon_rgb(image_bgr: np.ndarray, poly_pts) -> Image.Image:
    """Crop a polygon region from a BGR image and return RGB PIL image."""
    pts = np.array(poly_pts, dtype=np.float32)
    x1, y1 = pts.min(axis=0).astype(int)
    x2, y2 = pts.max(axis=0).astype(int)
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(image_bgr.shape[1], x2)
    y2 = min(image_bgr.shape[0], y2)
    if x2 <= x1 or y2 <= y1:
        return Image.new("RGB", (8, 8), (255, 255, 255))
    crop = image_bgr[y1:y2, x1:x2]
    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


class TrOCRRecognizer:
    """Lazy-loaded, cached TrOCR recognizer."""

    def __init__(self, model_dir: str, device: Optional[str] = None):
        self.model_dir = model_dir
        self._processor: Optional[TrOCRProcessor] = None
        self._model: Optional[VisionEncoderDecoderModel] = None

        if device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        logger.info(
            "TrOCRRecognizer created (model_dir=%s, device=%s, lazy-load)",
            os.path.basename(model_dir),
            self.device,
        )

    def _ensure_loaded(self):
        if self._processor is not None and self._model is not None:
            return

        logger.info("Loading TrOCR checkpoint: %s", self.model_dir)
        self._processor = TrOCRProcessor.from_pretrained(self.model_dir, local_files_only=True)
        self._model = VisionEncoderDecoderModel.from_pretrained(
            self.model_dir,
            local_files_only=True,
        ).to(self.device)
        self._model.eval()

    def predict_batch(self, images: list[Image.Image]) -> list[str]:
        if not images:
            return []
        self._ensure_loaded()

        rgb_images = [img.convert("RGB") for img in images]
        pixel_values = self._processor(images=rgb_images, return_tensors="pt").pixel_values.to(self.device)

        with torch.no_grad():
            generated_ids = self._model.generate(pixel_values, max_new_tokens=96)

        texts = self._processor.batch_decode(generated_ids, skip_special_tokens=True)
        return [t.strip() for t in texts]

    def unload(self):
        if self._model is not None:
            del self._model
            self._model = None
        if self._processor is not None:
            del self._processor
            self._processor = None
        gc.collect()
        if self.device == "cuda":
            torch.cuda.empty_cache()


_recognizer_cache: dict[str, TrOCRRecognizer] = {}


def get_recognizer(model_dir: str) -> TrOCRRecognizer:
    """Get (or create and cache) a TrOCR recognizer for the given directory."""
    if model_dir not in _recognizer_cache:
        _recognizer_cache[model_dir] = TrOCRRecognizer(model_dir)
    return _recognizer_cache[model_dir]
