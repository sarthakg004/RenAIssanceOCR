"""
Layout-Aware Line Detection API Route.

POST /api/detect/layout-aware-lines
  - Accepts multipart/form-data with image file + use_gpu flag
  - Returns detected text-line polygons as JSON

GPU / Memory requirements
-------------------------
  GPU mode : minimum 8 GB VRAM recommended (server-class models are large).
  CPU mode : minimum 8 GB RAM recommended; processing is significantly slower.

Concurrency
-----------
  A process-wide asyncio lock serializes detection calls. Paddle loads the
  server-class detection + recognition models (~1.5 GB each) fresh per call
  and frees them immediately afterwards, so running two pages simultaneously
  doubles the peak memory footprint and can trigger an OOM kill. The lock
  guarantees at most one page is in flight per worker, matching the
  "one-page-at-a-time, clean up between pages" behavior the pipeline was
  designed for.
"""

import asyncio
import time
import traceback

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, UploadFile

from ..services.layout_detection import (
    check_system_resources,
    run_layout_aware_detection,
    select_tier,
)

router = APIRouter()

# Serializes detection work within a single worker process. FastAPI runs async
# handlers on the event loop concurrently; without this, two pages posted in
# parallel both load paddle models at once and race for GPU VRAM / RAM.
_detection_lock = asyncio.Lock()


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
    debug_dir: str = Form(""),
):
    """
    Run the full layout-aware line-detection pipeline on an uploaded image.

    Returns
    -------
    {
      "lines": [ [[x,y],[x,y],[x,y],[x,y]], ... ],
      "count": int,
      "processing_time_ms": int
    }
    """
    start = time.time()

    try:
        # Read uploaded image
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        del contents

        if img is None:
            return {
                "error": "Could not decode the uploaded image.",
                "lines": [],
                "count": 0,
                "processing_time_ms": 0,
            }

        # Serialize detection across concurrent requests so only one page
        # loads paddle models at a time — two concurrent runs double peak
        # memory and OOM-kill the worker under server-class models. The
        # sync inner call is offloaded to a thread to keep the event loop
        # responsive for /api/health etc. while detection is in flight.
        async with _detection_lock:
            gpu_fallback = False
            resource_warnings = []

            # Probe free VRAM / RAM inside the lock (so readings reflect the
            # state at the moment we're about to load models) and pick the
            # model tier automatically. This protects users on 4-6 GB laptop
            # GPUs who would otherwise OOM on the server-class models.
            tier = await asyncio.to_thread(select_tier, use_gpu)
            print(f"[LayoutAPI] tier selected: {tier['tier']} on {tier['device']}"
                  f" — {tier['reason']}")
            effective_use_gpu = tier["device"] == "gpu"

            try:
                lines, resource_warnings = await asyncio.to_thread(
                    run_layout_aware_detection,
                    img,
                    use_gpu=effective_use_gpu,
                    layout_model_name=tier["layout_model"],
                    det_model_name=tier["det_model"],
                    rec_model_name=tier["rec_model"],
                    region_padding=region_padding,
                    layout_expand=layout_expand,
                    score_thresh=score_thresh,
                    upscale_min_h=upscale_min_h,
                    nms_iou_thresh=nms_iou_thresh,
                    gap_multiplier=gap_multiplier,
                    debug_dir=debug_dir,
                )
            except (ValueError, RuntimeError) as gpu_err:
                err_msg = str(gpu_err)
                # OOM errors contain a descriptive message from our wrappers
                if "Out-of-memory" in err_msg or "out of memory" in err_msg.lower():
                    elapsed = int((time.time() - start) * 1000)
                    return {
                        "error": err_msg,
                        "lines": [],
                        "count": 0,
                        "processing_time_ms": elapsed,
                        "resource_warnings": resource_warnings,
                        "tier": tier,
                        "resource_requirements": (
                            "Minimum 8 GB GPU VRAM required for GPU mode. "
                            "Minimum 8 GB free RAM required for CPU mode."
                        ),
                    }
                if effective_use_gpu:
                    # GPU run crashed for a non-OOM reason — retry on CPU at
                    # whichever model tier makes sense for the current free RAM.
                    print(f"[LayoutAPI] GPU failed, falling back to CPU: {gpu_err}")
                    gpu_fallback = True
                    cpu_tier = await asyncio.to_thread(select_tier, False)
                    tier = cpu_tier
                    lines, resource_warnings = await asyncio.to_thread(
                        run_layout_aware_detection,
                        img,
                        use_gpu=False,
                        layout_model_name=cpu_tier["layout_model"],
                        det_model_name=cpu_tier["det_model"],
                        rec_model_name=cpu_tier["rec_model"],
                        region_padding=region_padding,
                        layout_expand=layout_expand,
                        score_thresh=score_thresh,
                        upscale_min_h=upscale_min_h,
                        nms_iou_thresh=nms_iou_thresh,
                        gap_multiplier=gap_multiplier,
                        debug_dir=debug_dir,
                    )
                else:
                    raise

        del img
        elapsed = int((time.time() - start) * 1000)

        resp = {
            "lines": lines,
            "count": len(lines),
            "processing_time_ms": elapsed,
            "tier": tier,
        }
        if resource_warnings:
            resp["resource_warnings"] = resource_warnings
        if gpu_fallback:
            resp["warning"] = "GPU failed mid-run. Fell back to CPU."
        elif use_gpu and tier["device"] == "cpu":
            # User asked for GPU but not enough free VRAM for any GPU tier.
            resp["warning"] = (
                "Not enough free GPU VRAM for detection. "
                f"Ran on CPU instead. {tier['reason']}"
            )
        elif use_gpu and tier["tier"] == "mobile":
            # GPU mode but dropped to mobile models.
            resp["warning"] = (
                f"Low GPU VRAM — using lighter mobile models. {tier['reason']}"
            )
        if use_gpu and not gpu_fallback:
            # Surface the requirement even on success so the UI can show it
            resp["resource_requirements"] = (
                "Minimum 8 GB GPU VRAM recommended for GPU mode. "
                "Minimum 8 GB free RAM recommended for CPU mode."
            )
        return resp

    except Exception as exc:
        traceback.print_exc()
        elapsed = int((time.time() - start) * 1000)
        resp = {
            "error": f"Line detection failed: {str(exc)}",
            "lines": [],
            "count": 0,
            "processing_time_ms": elapsed,
        }
        # Include any resource warnings collected before the failure so the
        # caller knows whether insufficient GPU/RAM may have caused the error.
        try:
            if resource_warnings:
                resp["resource_warnings"] = resource_warnings
                resp["resource_requirements"] = (
                    "Minimum 8 GB GPU VRAM required for GPU mode. "
                    "Minimum 8 GB free RAM required for CPU mode."
                )
        except NameError:
            pass
        return resp
