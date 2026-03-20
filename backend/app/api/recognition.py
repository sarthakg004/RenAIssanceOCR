"""Recognition API Router — local (CRNN / TrOCR) model discovery and line OCR."""

import base64
import os
import time

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException

from ..schemas.recognition import (
    LocalModelInfo,
    LocalModelsResponse,
    LocalRecognizeRequest,
    LocalRecognizeResponse,
    LocalRecognizeResult,
)
from ..services.recognition.crnn_inference import (
    crop_polygon_gray,
    discover_models as discover_crnn_models,
    get_recognizer as get_crnn_recognizer,
)
from ..services.recognition.trocr_inference import (
    crop_polygon_rgb,
    discover_models as discover_trocr_models,
    get_recognizer as get_trocr_recognizer,
)

router = APIRouter()

# ── Where to scan for trained models ─────────────────────────────────
# Resolve relative to the repository root.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", ".."))
_MODEL_SEARCH_DIR = os.path.join(_PROJECT_ROOT, "backend", "models", "weights")

# Cache discovered models so we don't rescan on every request
_model_cache: list[dict] | None = None


def _get_models() -> list[dict]:
    global _model_cache
    if _model_cache is None:
        _model_cache = [
            *discover_crnn_models(os.path.join(_MODEL_SEARCH_DIR, "crnn")),
            *discover_trocr_models(os.path.join(_MODEL_SEARCH_DIR, "trocr")),
        ]
    return _model_cache


# ═════════════════════════════════════════════════════════════════════
# Model Listing
# ═════════════════════════════════════════════════════════════════════


@router.get("/api/local-recognition-models", response_model=LocalModelsResponse)
async def list_local_models():
    """Return all available local OCR model checkpoints."""
    models = _get_models()
    return LocalModelsResponse(
        models=[LocalModelInfo(**m) for m in models]
    )


@router.get("/api/crnn-models", response_model=LocalModelsResponse)
async def list_crnn_models():
    """Backward-compatible CRNN listing endpoint."""
    models = [m for m in _get_models() if m["model_type"] == "crnn"]
    return LocalModelsResponse(models=[LocalModelInfo(**m) for m in models])


@router.post("/api/local-recognition-models/refresh")
async def refresh_local_models():
    """Force rescan of model directory."""
    global _model_cache
    _model_cache = None
    models = _get_models()
    return {"count": len(models), "models": [m["name"] for m in models]}


@router.post("/api/crnn-models/refresh")
async def refresh_crnn_models():
    """Backward-compatible CRNN refresh endpoint."""
    data = await refresh_local_models()
    return {
        "count": len([name for name in data["models"] if name.lower().startswith("crnn")]),
        "models": [name for name in data["models"] if name.lower().startswith("crnn")],
    }


# ═════════════════════════════════════════════════════════════════════
# Recognition
# ═════════════════════════════════════════════════════════════════════


def _decode_image(image_data: str) -> np.ndarray:
    """Decode a base64 (optionally data-URL prefixed) image to BGR numpy."""
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    raw = base64.b64decode(image_data)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")
    return img


@router.post("/api/local-recognize", response_model=LocalRecognizeResponse)
async def local_recognize(request: LocalRecognizeRequest):
    """
    Run local OCR recognition (CRNN or TrOCR) on line-level bounding boxes.

    Expects:
    - image_data: base64 page image
    - boxes: list of polygons (each polygon = list of [x,y] points)
    - model_id: namespaced model id (e.g. "crnn:best_crnn", "trocr:default")
    """
    start = time.time()

    # ── Find model ────────────────────────────────────────────
    models = _get_models()
    model_info = next((m for m in models if m["id"] == request.model_id), None)
    if model_info is None:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{request.model_id}' not found. Available: {[m['id'] for m in models]}",
        )

    # ── Decode image ──────────────────────────────────────────
    try:
        image_bgr = _decode_image(request.image_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    model_type = model_info["model_type"]

    # ── Get recognizer (lazy-loaded + cached) ─────────────────
    try:
        if model_type == "crnn":
            recognizer = get_crnn_recognizer(model_info["path"])
        elif model_type == "trocr":
            recognizer = get_trocr_recognizer(model_info["path"])
        else:
            raise RuntimeError(f"Unsupported model type: {model_type}")
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load model '{request.model_id}': {e}",
        )

    # ── Crop and recognise each box ───────────────────────────
    results: list[LocalRecognizeResult] = []

    if len(request.boxes) > 0:
        # Crop all line images
        crops = []
        for i, box in enumerate(request.boxes):
            try:
                if model_type == "trocr":
                    crop = crop_polygon_rgb(image_bgr, box)
                else:
                    crop = crop_polygon_gray(image_bgr, box)
                crops.append((i, crop))
            except Exception as e:
                # If a single crop fails, record empty text
                results.append(LocalRecognizeResult(box_index=i, text=""))

        # Batch inference
        if crops:
            try:
                images = [c[1] for c in crops]
                texts = recognizer.predict_batch(images)
                for (idx, _), text in zip(crops, texts):
                    results.append(LocalRecognizeResult(box_index=idx, text=text))
            except Exception as e:
                # Fallback to single inference
                for idx, img in crops:
                    try:
                        if hasattr(recognizer, "predict"):
                            text = recognizer.predict(img)
                        else:
                            text = recognizer.predict_batch([img])[0]
                    except Exception:
                        text = ""
                    results.append(LocalRecognizeResult(box_index=idx, text=text))

    # Sort results by box_index
    results.sort(key=lambda r: r.box_index)

    elapsed_ms = int((time.time() - start) * 1000)

    return LocalRecognizeResponse(
        results=results,
        processing_time_ms=elapsed_ms,
        model_used=request.model_id,
        model_type=model_type,
        device=recognizer.device,
    )


@router.post("/api/crnn-recognize", response_model=LocalRecognizeResponse)
async def crnn_recognize(request: LocalRecognizeRequest):
    """Backward-compatible CRNN recognition endpoint."""
    req_model_id = request.model_id
    if not req_model_id.startswith("crnn:"):
        request = LocalRecognizeRequest(
            image_data=request.image_data,
            boxes=request.boxes,
            model_id=f"crnn:{req_model_id}",
        )
    return await local_recognize(request)
