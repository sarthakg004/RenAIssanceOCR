"""Line- and page-level evaluation using the app's own detection and recognizers."""

import json

import cv2
import numpy as np
from PIL import Image

from . import paths  # noqa: F401  (puts backend/ on sys.path)
from .metrics import cer, wer
from .pages import Page

# The PORCONES recipe from the preprocessing notebook, built from the app's operations.
CLEAN = [{"op": "grayscale"}, {"op": "deskew", "params": {"mode": "auto"}},
         {"op": "normalize", "params": {"strength": 100}},
         {"op": "denoise", "params": {"method": "nlm", "strength": 10}},
         {"op": "morph", "params": {"operation": "open", "kernelSize": 2, "kernelShape": "rect", "iterations": 2}},
         {"op": "threshold", "params": {"method": "otsu"}}]
PIPELINES = {"raw": [], "cleaned": CLEAN}


def scores(predictions: list[str], references: list[str]) -> dict:
    return {"cer": cer(predictions, references), "wer": wer(predictions, references), "n": len(references)}


def match_lines(truth: list[str], predicted: list[str], min_ratio: float = 50) -> list[str | None]:
    """Pair each true line with the most similar predicted line, each prediction used at most once.
    None means detection lost the line (no unused prediction is at least min_ratio similar)."""
    from rapidfuzz import fuzz

    pairs = sorted(((fuzz.ratio(t, p), i, j) for i, t in enumerate(truth) for j, p in enumerate(predicted)),
                   reverse=True)
    matched, used = [None] * len(truth), set()
    for ratio, i, j in pairs:  # ponytail: greedy by similarity, O(n·m) pairs; fine for ~20 lines a page
        if ratio >= min_ratio and matched[i] is None and j not in used:
            matched[i] = predicted[j]
            used.add(j)
    return matched


class PageDetector:
    """Preprocess a page and find its text lines exactly as the app does.

    Boxes are cached next to each page image, so the slow GPU detection runs once
    and every recognizer reads the same lines.
    """

    def __init__(self, pipeline: str = "raw"):
        self.pipeline = pipeline

    def image(self, page: Page) -> np.ndarray:
        from preprocessing import run_pipeline

        img = cv2.imread(str(page.image))
        out = run_pipeline(img, PIPELINES[self.pipeline]).image
        return out if out.ndim == 3 else cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)

    def boxes(self, page: Page) -> list:
        cache = page.image.with_suffix(f".{self.pipeline}.boxes.json")
        if not cache.exists():
            from app.services.layout_detection import run_layout_aware_detection, select_tier

            tier = select_tier(use_gpu=True)
            lines, _ = run_layout_aware_detection(
                self.image(page), use_gpu=tier["device"] == "gpu",
                layout_model_name=tier["layout_model"], det_model_name=tier["det_model"])
            cache.write_text(json.dumps(lines))
        return json.loads(cache.read_text())


class Recognizer:
    """One of the app's line recognizers, loaded from a checkpoint path."""

    def __init__(self, kind: str, path: str):
        from app.services.recognition import crnn_inference, trocr_inference

        module = {"crnn": crnn_inference, "trocr": trocr_inference}[kind]
        recognizer_cls = module.CRNNRecognizer if kind == "crnn" else module.TrOCRRecognizer
        self.model = recognizer_cls(str(path))
        self.crop = module.crop_polygon_gray if kind == "crnn" else module.crop_polygon_rgb

    def read(self, images: list[Image.Image], batch: int = 32) -> list[str]:
        return [t for i in range(0, len(images), batch) for t in self.model.predict_batch(images[i:i + batch])]

    def read_page(self, image: np.ndarray, boxes: list) -> list[str]:
        """One string per detected line, in the detector's reading order."""
        return self.read([self.crop(image, b) for b in boxes]) if boxes else []
