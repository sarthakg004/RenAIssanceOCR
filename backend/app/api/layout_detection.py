"""
Layout-Aware Line Detection API Route.

POST /api/detect/layout-aware-lines
  - Accepts multipart/form-data with image file + use_gpu flag
  - Returns detected text-line polygons as JSON
"""

import time
import traceback

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, UploadFile

from ..services.layout_detection import run_layout_aware_detection

router = APIRouter()


@router.post("/api/detect/layout-aware-lines")
async def detect_layout_aware_lines(
    image: UploadFile = File(...),
    use_gpu: bool = Form(False),
    layout_model: str = Form("PP-DocLayout_plus-L"),
    det_model: str = Form("PP-OCRv5_server_det"),
    region_padding: int = Form(50),
    layout_expand: int = Form(2),
    score_thresh: float = Form(0.5),
    upscale_min_h: int = Form(60),
    nms_iou_thresh: float = Form(0.3),
    gap_multiplier: float = Form(2.0),
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

        # Attempt GPU; fall back to CPU on failure
        gpu_fallback = False
        try:
            lines = run_layout_aware_detection(
                img,
                use_gpu=use_gpu,
                layout_model_name=layout_model,
                det_model_name=det_model,
                region_padding=region_padding,
                layout_expand=layout_expand,
                score_thresh=score_thresh,
                upscale_min_h=upscale_min_h,
                nms_iou_thresh=nms_iou_thresh,
                gap_multiplier=gap_multiplier,
            )
        except Exception as gpu_err:
            if use_gpu:
                print(f"[LayoutAPI] GPU failed, falling back to CPU: {gpu_err}")
                gpu_fallback = True
                lines = run_layout_aware_detection(
                    img,
                    use_gpu=False,
                    layout_model_name=layout_model,
                    det_model_name=det_model,
                    region_padding=region_padding,
                    layout_expand=layout_expand,
                    score_thresh=score_thresh,
                    upscale_min_h=upscale_min_h,
                    nms_iou_thresh=nms_iou_thresh,
                    gap_multiplier=gap_multiplier,
                )
            else:
                raise

        del img
        elapsed = int((time.time() - start) * 1000)

        resp = {
            "lines": lines,
            "count": len(lines),
            "processing_time_ms": elapsed,
        }
        if gpu_fallback:
            resp["warning"] = "GPU not available. Ran on CPU instead."
        return resp

    except Exception as exc:
        traceback.print_exc()
        elapsed = int((time.time() - start) * 1000)
        return {
            "error": f"Line detection failed: {str(exc)}",
            "lines": [],
            "count": 0,
            "processing_time_ms": elapsed,
        }
