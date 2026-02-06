"""
OpenCV-based Preprocessing Operations for OCR

Each operation follows the contract:
- Input: numpy image, params dict, optional progress callback
- Output: processed numpy image

All operations preserve image integrity and handle both grayscale and color images.
"""

import cv2
import numpy as np
from typing import Dict, Any, Optional, Callable


# Type alias for progress callback
ProgressCallbackType = Optional[Callable[[float, str], None]]


# ============================================
# BASIC PROCESSING
# ============================================

def normalize_image(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Normalize image brightness and contrast levels.
    
    Uses histogram stretching with configurable strength.
    
    Params:
        strength: Normalization strength 0-100 (default: 50)
    
    Returns:
        Normalized image
    """
    if progress:
        progress(0.1, "Analyzing histogram")
    
    strength = params.get("strength", 50) / 100.0
    
    # Handle grayscale and color images
    if len(img.shape) == 2:
        # Grayscale
        normalized = _normalize_channel(img, strength)
    else:
        # Color - normalize each channel
        channels = cv2.split(img)
        normalized_channels = []
        for i, ch in enumerate(channels):
            if progress:
                progress(0.2 + (i * 0.25), f"Normalizing channel {i+1}")
            normalized_channels.append(_normalize_channel(ch, strength))
        normalized = cv2.merge(normalized_channels)
    
    if progress:
        progress(1.0, "Normalize complete")
    
    return normalized


def _normalize_channel(channel: np.ndarray, strength: float) -> np.ndarray:
    """Normalize a single channel with given strength"""
    # Find current min/max
    min_val = np.min(channel)
    max_val = np.max(channel)
    
    if max_val == min_val:
        return channel
    
    # Full normalization
    full_normalized = cv2.normalize(channel, None, 0, 255, cv2.NORM_MINMAX)
    
    # Blend based on strength
    if strength >= 1.0:
        return full_normalized
    
    return cv2.addWeighted(
        channel.astype(np.float32), 1 - strength,
        full_normalized.astype(np.float32), strength,
        0
    ).astype(np.uint8)


def to_grayscale(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Convert image to grayscale.
    
    Handles already grayscale images gracefully.
    
    Params:
        (none - no parameters needed)
    
    Returns:
        Grayscale image
    """
    if progress:
        progress(0.2, "Converting to grayscale")
    
    if len(img.shape) == 2:
        # Already grayscale
        result = img
    elif len(img.shape) == 3 and img.shape[2] == 1:
        # Single channel but 3D
        result = img.squeeze()
    else:
        # Color to grayscale
        result = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    if progress:
        progress(1.0, "Grayscale complete")
    
    return result


def deskew_image(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Automatically detect and correct image skew/rotation.
    
    Uses contour analysis and Hough line detection for robust skew estimation.
    
    Params:
        maxAngle: Maximum skew angle to correct (default: 15 degrees)
    
    Returns:
        Deskewed image
    """
    if progress:
        progress(0.1, "Preparing deskew analysis")
    
    max_angle = params.get("maxAngle", 15)
    
    # Convert to grayscale for analysis if needed
    is_color = len(img.shape) == 3
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if is_color else img.copy()
    
    if progress:
        progress(0.2, "Detecting skew angle")
    
    # Method 1: Use minimum area rectangle on largest contour
    angle = _detect_skew_contour(gray)
    
    # If contour method gives unreliable result, try Hough lines
    if angle is None or abs(angle) > max_angle:
        if progress:
            progress(0.4, "Using line detection")
        angle = _detect_skew_hough(gray)
    
    # Clamp angle to max allowed
    if angle is None:
        angle = 0
    angle = max(-max_angle, min(max_angle, angle))
    
    if progress:
        progress(0.6, f"Rotating by {angle:.2f}°")
    
    # Skip if angle is negligible
    if abs(angle) < 0.1:
        if progress:
            progress(1.0, "No significant skew detected")
        return img
    
    # Rotate image
    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    
    # Use border replication for cleaner edges
    rotated = cv2.warpAffine(
        img, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE
    )
    
    if progress:
        progress(1.0, "Deskew complete")
    
    return rotated


def _detect_skew_contour(gray: np.ndarray) -> Optional[float]:
    """Detect skew using contour analysis"""
    # Threshold to get binary image
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    
    # Find contours
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return None
    
    # Find the largest contour
    largest = max(contours, key=cv2.contourArea)
    
    # Get minimum area rectangle
    rect = cv2.minAreaRect(largest)
    angle = rect[-1]
    
    # Normalize angle
    if angle < -45:
        angle += 90
    elif angle > 45:
        angle -= 90
    
    return angle


def _detect_skew_hough(gray: np.ndarray) -> Optional[float]:
    """Detect skew using Hough line transform"""
    # Edge detection
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    
    # Detect lines
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180,
        threshold=100,
        minLineLength=gray.shape[1] // 4,
        maxLineGap=10
    )
    
    if lines is None or len(lines) == 0:
        return None
    
    # Calculate angles of all lines
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 != x1:
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            # Only consider near-horizontal lines
            if abs(angle) < 45:
                angles.append(angle)
    
    if not angles:
        return None
    
    # Return median angle
    return np.median(angles)


# ============================================
# ENHANCEMENT
# ============================================

def denoise_image(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Remove noise while preserving text edges.
    
    Supports multiple denoising methods:
    - nlm: Non-Local Means (best quality, slower)
    - bilateral: Bilateral filter (edge-preserving)
    - gaussian: Gaussian blur (fastest, less edge-preserving)
    
    Params:
        method: 'nlm', 'bilateral', or 'gaussian' (default: 'nlm')
        strength: Denoising strength 1-20 (default: 10)
    
    Returns:
        Denoised image
    """
    if progress:
        progress(0.1, "Preparing denoising")
    
    method = params.get("method", "nlm")
    strength = params.get("strength", 10)
    
    # Ensure image is uint8
    img = img.astype(np.uint8)
    
    if progress:
        progress(0.2, f"Applying {method} denoising")
    
    if method == "bilateral":
        # Bilateral filter - edge-preserving smoothing
        d = max(5, min(15, int(strength)))
        sigma_color = strength * 7.5
        sigma_space = strength * 7.5
        result = cv2.bilateralFilter(img, d, sigma_color, sigma_space)
        
    elif method == "gaussian":
        # Gaussian blur - simple but effective
        ksize = max(3, int(strength) | 1)  # Ensure odd
        result = cv2.GaussianBlur(img, (ksize, ksize), 0)
        
    else:  # nlm (default)
        # Non-Local Means - best quality
        h = max(3, min(30, strength))  # Filter strength
        template_window = 7
        search_window = 21
        
        if len(img.shape) == 3:
            result = cv2.fastNlMeansDenoisingColored(
                img, None, h, h, template_window, search_window
            )
        else:
            result = cv2.fastNlMeansDenoising(
                img, None, h, template_window, search_window
            )
    
    if progress:
        progress(1.0, "Denoise complete")
    
    return result


def clahe_contrast(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization).
    
    CLAHE improves local contrast while limiting noise amplification.
    
    Params:
        clipLimit: Contrast limit (default: 2.0)
        tileSize: Size of grid tiles (default: 8)
    
    Returns:
        Contrast-enhanced image
    """
    if progress:
        progress(0.1, "Preparing CLAHE")
    
    clip_limit = params.get("clipLimit", 2.0)
    tile_size = params.get("tileSize", 8)
    
    # Ensure tile_size is valid
    tile_size = max(2, min(16, int(tile_size)))
    
    # Create CLAHE object
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile_size, tile_size))
    
    if progress:
        progress(0.3, "Applying CLAHE")
    
    if len(img.shape) == 2:
        # Grayscale - apply directly
        result = clahe.apply(img)
    else:
        # Color - apply to L channel in LAB space
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        
        if progress:
            progress(0.5, "Enhancing luminance")
        
        l = clahe.apply(l)
        lab = cv2.merge([l, a, b])
        result = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    
    if progress:
        progress(1.0, "Contrast enhancement complete")
    
    return result


def sharpen_image(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Sharpen text edges using unsharp masking.
    
    Improves text clarity and definition.
    
    Params:
        amount: Sharpening amount 0-100 (default: 50)
        radius: Blur radius in pixels 0.5-3 (default: 1)
    
    Returns:
        Sharpened image
    """
    if progress:
        progress(0.1, "Preparing sharpening")
    
    amount = params.get("amount", 50) / 100.0
    radius = params.get("radius", 1.0)
    
    if amount <= 0:
        if progress:
            progress(1.0, "No sharpening applied")
        return img
    
    # Calculate kernel size from radius
    ksize = max(3, int(radius * 2) | 1)  # Ensure odd
    
    if progress:
        progress(0.3, "Creating blur mask")
    
    # Create blurred version
    if len(img.shape) == 3:
        blurred = cv2.GaussianBlur(img, (ksize, ksize), radius)
    else:
        blurred = cv2.GaussianBlur(img, (ksize, ksize), radius)
    
    if progress:
        progress(0.6, "Applying unsharp mask")
    
    # Unsharp mask: original + amount * (original - blurred)
    # This enhances edges by adding back the high-frequency components
    sharpened = cv2.addWeighted(
        img.astype(np.float32), 1.0 + amount,
        blurred.astype(np.float32), -amount,
        0
    )
    
    # Clip to valid range
    result = np.clip(sharpened, 0, 255).astype(np.uint8)
    
    if progress:
        progress(1.0, "Sharpen complete")
    
    return result


# ============================================
# BINARIZATION
# ============================================

def threshold_image(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Convert image to binary (black and white).
    
    Supports multiple thresholding methods:
    - otsu: Automatic global threshold (Otsu's method)
    - adaptive: Local adaptive thresholding
    - sauvola: Sauvola's adaptive method (good for documents)
    
    Params:
        method: 'otsu', 'adaptive', or 'sauvola' (default: 'otsu')
        blockSize: Block size for adaptive methods (default: 15)
        k: Sensitivity parameter for Sauvola (default: 0.5)
    
    Returns:
        Binary image
    """
    if progress:
        progress(0.1, "Preparing binarization")
    
    method = params.get("method", "otsu")
    block_size = params.get("blockSize", 15)
    k = params.get("k", 0.5)
    
    # Ensure blockSize is odd and >= 3
    block_size = max(3, int(block_size) | 1)
    
    # Convert to grayscale if needed
    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()
    
    if progress:
        progress(0.3, f"Applying {method} thresholding")
    
    if method == "adaptive":
        # Adaptive thresholding
        result = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            block_size, 8
        )
        
    elif method == "sauvola":
        # Sauvola's method - good for degraded documents
        result = _sauvola_threshold(gray, block_size, k, progress)
        
    else:  # otsu (default)
        # Otsu's automatic global threshold
        _, result = cv2.threshold(
            gray, 0, 255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
    
    if progress:
        progress(1.0, "Binarization complete")
    
    return result


def _sauvola_threshold(
    gray: np.ndarray,
    window_size: int,
    k: float,
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Sauvola's adaptive thresholding.
    
    T(x,y) = mean(x,y) * (1 + k * (std(x,y) / R - 1))
    where R is the maximum standard deviation (128 for 8-bit images)
    """
    # Use integral images for efficient computation
    if progress:
        progress(0.4, "Computing local statistics")
    
    # Compute mean using box filter
    mean = cv2.blur(gray.astype(np.float64), (window_size, window_size))
    
    # Compute squared mean for variance
    sq_mean = cv2.blur(gray.astype(np.float64) ** 2, (window_size, window_size))
    
    # Variance and standard deviation
    variance = sq_mean - mean ** 2
    variance = np.maximum(variance, 0)  # Handle numerical errors
    std = np.sqrt(variance)
    
    if progress:
        progress(0.7, "Computing threshold map")
    
    # Sauvola threshold
    R = 128.0  # Maximum standard deviation for 8-bit
    threshold = mean * (1.0 + k * (std / R - 1.0))
    
    if progress:
        progress(0.9, "Applying threshold")
    
    # Apply threshold
    result = np.zeros_like(gray)
    result[gray > threshold] = 255
    
    return result.astype(np.uint8)


# ============================================
# OPERATION REGISTRY
# ============================================

OP_REGISTRY = {
    "normalize": normalize_image,
    "grayscale": to_grayscale,
    "deskew": deskew_image,
    "denoise": denoise_image,
    "contrast": clahe_contrast,
    "sharpen": sharpen_image,
    "threshold": threshold_image,
}


def get_operation(name: str):
    """Get operation function by name"""
    return OP_REGISTRY.get(name)


def list_operations() -> list[str]:
    """List all available operation names"""
    return list(OP_REGISTRY.keys())
