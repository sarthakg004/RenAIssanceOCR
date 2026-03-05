"""
Preprocessing API Router — all preprocessing-related endpoints.
"""

import os
import sys
import time
import base64
import numpy as np
import cv2

from fastapi import APIRouter, HTTPException

from ..schemas.ocr import PreprocessRequest

# Ensure backend directory is in path for preprocessing module imports
backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from preprocessing import run_pipeline, OP_REGISTRY, validate_pipeline_config


router = APIRouter()


@router.get("/api/preprocess/operations")
async def get_available_operations():
    """Get list of available preprocessing operations"""
    return {
        "operations": list(OP_REGISTRY.keys()),
        "descriptions": {
            "normalize": "Normalize image brightness and contrast levels",
            "grayscale": "Convert image to grayscale",
            "deskew": "Automatically correct image rotation/skew",
            "denoise": "Remove noise while preserving text edges",
            "contrast": "Enhance contrast using CLAHE",
            "sharpen": "Sharpen text edges for clearer text",
            "threshold": "Convert to binary (black and white)",
            "morph": "Morphological operations (open, close, dilate, erode, gradient, tophat, blackhat)",
            "remove_blobs": "Remove large ink blobs from scanned documents",
            "remove_noise": "Remove small speckles and scanning dust",
        }
    }


@router.post("/api/preprocess")
async def preprocess_image_endpoint(request: PreprocessRequest):
    """
    Apply preprocessing pipeline to an image.

    JSON Body:
        image_data: Base64 encoded image (with or without data URL prefix)
        operations: List of operations to apply
        preview_mode: Use faster algorithms for preview (optional)

    Returns:
        Processed image as base64, processing info
    """
    start_time = time.time()

    try:
        # Validate operations config
        validation = validate_pipeline_config(request.operations)
        if not validation["valid"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_operations",
                    "message": "Invalid pipeline configuration",
                    "errors": validation["errors"]
                }
            )

        # Parse base64 image data
        image_data = request.image_data
        if "," in image_data:
            # Has data URL prefix like "data:image/png;base64,..."
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
        else:
            encoded = image_data
            mime_type = "image/png"

        # Decode image
        image_bytes = base64.b64decode(encoded)
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise HTTPException(
                status_code=400,
                detail={"error": "invalid_image", "message": "Could not decode image"}
            )

        # Run preprocessing pipeline
        result = run_pipeline(
            image=image,
            steps=request.operations,
            continue_on_error=True,
            preview_mode=request.preview_mode,
        )

        # Encode result image
        if result.image is not None:
            # Determine output format based on input
            if "jpeg" in mime_type or "jpg" in mime_type:
                encode_param = [cv2.IMWRITE_JPEG_QUALITY, 95]
                _, buffer = cv2.imencode('.jpg', result.image, encode_param)
                output_mime = "image/jpeg"
            else:
                _, buffer = cv2.imencode('.png', result.image)
                output_mime = "image/png"

            encoded_result = base64.b64encode(buffer).decode('utf-8')
            result_data_url = f"data:{output_mime};base64,{encoded_result}"
        else:
            result_data_url = None

        processing_time = int((time.time() - start_time) * 1000)

        return {
            "success": result.success,
            "processed_image": result_data_url,
            "processing_time_ms": processing_time,
            "progress_info": result.progress_info,
            "errors": [
                {"step": e["step"], "error": e["error"]}
                for e in result.errors
            ] if result.errors else [],
        }

    except HTTPException:
        raise
    except Exception as e:
        processing_time = int((time.time() - start_time) * 1000)
        return {
            "success": False,
            "processed_image": None,
            "processing_time_ms": processing_time,
            "error": str(e),
        }


@router.post("/api/preprocess/validate")
async def validate_operations(operations: list):
    """
    Validate preprocessing pipeline configuration.

    JSON Body:
        List of operations to validate

    Returns:
        Validation result with any errors
    """
    validation = validate_pipeline_config(operations)
    return validation
