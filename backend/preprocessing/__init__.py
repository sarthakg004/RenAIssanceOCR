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
- morph: Morphological operations (open, close, dilate, erode, gradient, tophat, blackhat)
- remove_blobs: Remove large ink blobs from scanned documents
- remove_noise: Remove small speckles and scanning dust
"""

from .operations import (
    normalize_image,
    to_grayscale,
    deskew_image,
    denoise_image,
    clahe_contrast,
    sharpen_image,
    threshold_image,
    morph_operations,
    remove_large_blobs,
    remove_small_noise,
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
    'morph_operations',
    'remove_large_blobs',
    'remove_small_noise',
    'OP_REGISTRY',
    # Pipeline
    'run_pipeline',
    'PipelineExecutor',
    'validate_pipeline_config',
    # Progress
    'ProgressCallback',
    'create_progress_callback',
]

