"""POST /api/detect/layout-aware-lines — image in, text-line polygons out.

One page at a time per worker: the models are ~1.5 GB each and loaded fresh per
call, so two concurrent pages double peak memory and get the worker OOM-killed.
Budget 8 GB VRAM (GPU) or 8 GB RAM (CPU, much slower).
"""

import asyncio
import logging
import time

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, UploadFile

from ..services.layout_detection import (
    models_cached,
    run_layout_aware_detection,
    select_tier,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/detect/models-status")
async def detection_models_status(use_gpu: bool = True):
    """Are the detection models on disk yet?

    The UI checks this first so it can warn about the one-time ~15-20 min
    download. Filesystem check only — never imports paddle.
    """
    return {"models_ready": models_cached(use_gpu)}

# FastAPI runs async handlers concurrently; without this two parallel pages
# both load paddle models and fight over VRAM.
_detection_lock = asyncio.Lock()


REQUIREMENTS = ("Minimum 8 GB GPU VRAM required for GPU mode. "
                "Minimum 8 GB free RAM required for CPU mode.")


@router.post("/api/detect/layout-aware-lines")
async def detect_layout_aware_lines(
    image: UploadFile = File(...),
    use_gpu: bool = Form(False),
    region_padding: int = Form(50),
    layout_expand: int = Form(2),
    score_thresh: float = Form(0.5),
    upscale_min_h: int = Form(60),
    nms_iou_thresh: float = Form(0.3),
    gap_multiplier: float = Form(2.0),
):
    """Detect text lines in an uploaded page.

    -> {lines: [4-point polygons], count, processing_time_ms, tier}.
    """
    start = time.time()
    elapsed = lambda: int((time.time() - start) * 1000)
    failed = lambda error, **extra: {"error": error, "lines": [], "count": 0,
                                      "processing_time_ms": elapsed(), **extra}
    tuning = dict(region_padding=region_padding, layout_expand=layout_expand, score_thresh=score_thresh,
                  upscale_min_h=upscale_min_h, nms_iou_thresh=nms_iou_thresh, gap_multiplier=gap_multiplier)

    def run(img, tier):
        # Sync GPU work goes to a thread so /api/health stays responsive.
        return asyncio.to_thread(run_layout_aware_detection, img, use_gpu=tier["device"] == "gpu",
                                 layout_model_name=tier["layout_model"], det_model_name=tier["det_model"],
                                 **tuning)

    try:
        img = cv2.imdecode(np.frombuffer(await image.read(), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return failed("Could not decode the uploaded image.")

        async with _detection_lock:
            # Probe inside the lock so the readings match what we're about to
            # allocate. Keeps 4-6 GB laptop GPUs off the server-class models.
            tier = await asyncio.to_thread(select_tier, use_gpu)
            logger.info("tier %s on %s: %s", tier["tier"], tier["device"], tier["reason"])
            gpu_fallback = False
            try:
                lines, warnings = await run(img, tier)
            except (ValueError, RuntimeError) as err:
                if "out-of-memory" in str(err).lower() or "out of memory" in str(err).lower():
                    return failed(str(err), resource_warnings=[], tier=tier, resource_requirements=REQUIREMENTS)
                if tier["device"] != "gpu":
                    raise
                # Crashed on the GPU for some non-OOM reason: retry on the CPU.
                logger.warning("GPU detection failed, falling back to CPU: %s", err)
                gpu_fallback = True
                tier = await asyncio.to_thread(select_tier, False)
                lines, warnings = await run(img, tier)

        resp = {"lines": lines, "count": len(lines), "processing_time_ms": elapsed(), "tier": tier}
        if warnings:
            resp["resource_warnings"] = warnings
        if gpu_fallback:
            resp["warning"] = "GPU failed mid-run. Fell back to CPU."
        elif use_gpu and tier["device"] == "cpu":
            resp["warning"] = f"Not enough free GPU VRAM for detection. Ran on CPU instead. {tier['reason']}"
        elif use_gpu and tier["tier"] == "mobile":
            resp["warning"] = f"Low GPU VRAM — using lighter mobile models. {tier['reason']}"
        if use_gpu and not gpu_fallback:
            resp["resource_requirements"] = REQUIREMENTS.replace("required", "recommended")
        return resp

    except Exception as exc:
        logger.exception("line detection failed")
        return failed(f"Line detection failed: {exc}")
