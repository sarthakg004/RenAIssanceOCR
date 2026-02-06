"""
Preprocessing Module for RenAIssance OCR

This module provides OpenCV-based image preprocessing operations
optimized for historical document OCR.

Operations:
- normalize: Normalize image brightness and contrast
- grayscale: Convert to grayscale
- deskew: Correct image rotation/skew
- denoise: Remove noise while preserving text
- contrast: Enhance contrast using CLAHE
- sharpen: Sharpen text edges
- threshold: Binarization (Otsu, adaptive, Sauvola)
"""

from .operations import (
    normalize_image,
    to_grayscale,
    deskew_image,
    denoise_image,
    clahe_contrast,
    sharpen_image,
    threshold_image,
    OP_REGISTRY,
)

from .pipeline import run_pipeline, PipelineExecutor, validate_pipeline_config

from .progress import ProgressCallback, create_progress_callback

__all__ = [
    # Operations
    'normalize_image',
    'to_grayscale',
    'deskew_image',
    'denoise_image',
    'clahe_contrast',
    'sharpen_image',
    'threshold_image',
    'OP_REGISTRY',
    # Pipeline
    'run_pipeline',
    'PipelineExecutor',
    'validate_pipeline_config',
    # Progress
    'ProgressCallback',
    'create_progress_callback',
]
