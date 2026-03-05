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
# MORPHOLOGICAL OPERATIONS
# ============================================

def morph_operations(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Apply morphological transformations to clean up text and artifacts.

    Supports multiple operations and kernel shapes for fine-grained control.

    Params:
        operation: 'open', 'close', 'dilate', 'erode', 'gradient',
                   'tophat', or 'blackhat' (default: 'open')
        kernelSize: Size of structuring element 1-9 (default: 2)
        kernelShape: 'ellipse', 'rect', or 'cross' (default: 'ellipse')
        iterations: Number of times to apply 1-10 (default: 1)

    Returns:
        Morphologically processed image
    """
    if progress:
        progress(0.1, "Preparing morphological operation")

    operation = params.get("operation", "open")
    k = max(1, min(9, int(params.get("kernelSize", 2))))
    shape_name = params.get("kernelShape", "ellipse")
    iterations = max(1, min(10, int(params.get("iterations", 1))))

    # Select kernel shape
    shape_map = {
        "ellipse": cv2.MORPH_ELLIPSE,
        "rect": cv2.MORPH_RECT,
        "cross": cv2.MORPH_CROSS,
    }
    shape = shape_map.get(shape_name, cv2.MORPH_ELLIPSE)
    kernel = cv2.getStructuringElement(shape, (k, k))

    if progress:
        progress(0.3, f"Applying {operation} (k={k}, iter={iterations})")

    # Map operation name to OpenCV constant or direct function
    morph_ops = {
        "open": cv2.MORPH_OPEN,
        "close": cv2.MORPH_CLOSE,
        "gradient": cv2.MORPH_GRADIENT,
        "tophat": cv2.MORPH_TOPHAT,
        "blackhat": cv2.MORPH_BLACKHAT,
    }

    if operation in morph_ops:
        result = cv2.morphologyEx(
            img, morph_ops[operation], kernel, iterations=iterations
        )
    elif operation == "dilate":
        result = cv2.dilate(img, kernel, iterations=iterations)
    elif operation == "erode":
        result = cv2.erode(img, kernel, iterations=iterations)
    else:
        # Fallback to open
        result = cv2.morphologyEx(
            img, cv2.MORPH_OPEN, kernel, iterations=iterations
        )

    if progress:
        progress(1.0, "Morphological operation complete")

    return result


# ============================================
# BLOB & NOISE REMOVAL
# ============================================

def remove_large_blobs(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Neutralise large ink blobs by filling only their inner core with white.

    Instead of erasing the entire connected component (which risks removing
    adjacent letters), we classify large components as blobs using three gates
    (area, solidity, aspect ratio), erode each blob mask inward, and paint
    only the safe interior core white.

    Params:
        minArea: Components smaller than this are kept (default: 3000)
        minSolidity: Compactness threshold 0-1; raise to be more
                     conservative (default: 0.55)
        maxAspectRatio: Elongated components (text) are always kept
                        (default: 4.0)
        erosionRatio: Fraction of sqrt(area) used as erosion kernel
                      radius; larger = smaller core removed, safer
                      (default: 0.35)

    Returns:
        Cleaned binary image
    """
    if progress:
        progress(0.1, "Preparing blob detection")

    min_area = int(params.get("minArea", 3000))
    min_solidity = float(params.get("minSolidity", 0.55))
    max_aspect_ratio = float(params.get("maxAspectRatio", 4.0))
    erosion_ratio = float(params.get("erosionRatio", 0.35))

    # Convert to grayscale + binary
    gray = img if len(img.shape) == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)

    # Work on inverted image (blobs = white foreground on black)
    inverted = cv2.bitwise_not(binary)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
        inverted, connectivity=8
    )

    if progress:
        progress(0.3, f"Analyzing {num_labels - 1} components")

    result = binary.copy()

    for lbl in range(1, num_labels):
        area = stats[lbl, cv2.CC_STAT_AREA]

        # Gate 1: small → normal character → skip
        if area <= min_area:
            continue

        w = stats[lbl, cv2.CC_STAT_WIDTH]
        h = stats[lbl, cv2.CC_STAT_HEIGHT]
        aspect = max(w, h) / max(min(w, h), 1)

        # Gate 2: elongated → text stroke / border → skip
        if aspect > max_aspect_ratio:
            continue

        # Gate 3: low solidity → complex text shape → skip
        component_mask = np.uint8(labels == lbl) * 255
        contours, _ = cv2.findContours(
            component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if not contours:
            continue

        hull_area = cv2.contourArea(cv2.convexHull(contours[0]))
        solidity = float(area) / hull_area if hull_area > 0 else 0.0

        if solidity < min_solidity:
            continue

        # Confirmed blob → erode inward to get safe inner core
        k_radius = max(3, int(erosion_ratio * (area ** 0.5)))
        k_size = 2 * k_radius + 1
        kern = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (k_size, k_size)
        )
        core = cv2.erode(component_mask, kern, iterations=1)

        # Paint the core white (background) in the output
        result[core == 255] = 255

        if progress:
            pct = 0.3 + 0.6 * (lbl / max(num_labels - 1, 1))
            progress(min(pct, 0.9), f"Processing blob {lbl}")

    if progress:
        progress(1.0, "Blob removal complete")

    return result


def remove_small_noise(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    """
    Remove very small connected components (scanning speckles / dust).

    Finds all connected foreground components and discards any whose area
    is below the threshold, effectively cleaning up scanning artifacts.

    Params:
        maxArea: Components with area below this are removed (default: 20)

    Returns:
        Cleaned binary image
    """
    if progress:
        progress(0.1, "Preparing noise detection")

    max_area = max(1, int(params.get("maxArea", 20)))

    # Convert to grayscale + binary
    gray = img if len(img.shape) == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)

    inverted = cv2.bitwise_not(binary)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
        inverted, connectivity=8
    )

    if progress:
        progress(0.4, f"Filtering {num_labels - 1} components (threshold={max_area})")

    keep_mask = np.zeros_like(inverted)
    for lbl in range(1, num_labels):
        area = stats[lbl, cv2.CC_STAT_AREA]
        if area >= max_area:
            keep_mask[labels == lbl] = 255

    result = cv2.bitwise_not(keep_mask)

    if progress:
        progress(1.0, "Small noise removal complete")

    return result


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
    "morph": morph_operations,
    "remove_blobs": remove_large_blobs,
    "remove_noise": remove_small_noise,
}


def get_operation(name: str):
    """Get operation function by name"""
    return OP_REGISTRY.get(name)


def list_operations() -> list[str]:
    """List all available operation names"""
    return list(OP_REGISTRY.keys())
