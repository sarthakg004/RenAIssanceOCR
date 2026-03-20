"""
OCR Dataset Builder Service

Builds line-level OCR training datasets by:
  1. Aligning sorted bounding boxes with transcript lines
  2. Cropping line images with padding
  3. Exporting in multiple formats (CSV, TrOCR, CRNN, PaddleOCR)

Memory-efficient: processes one page at a time and releases arrays.
"""

import csv
import io
import re
import zipfile
from typing import Any, Dict, List, Tuple

import cv2
import numpy as np


# ── Alignment ───────────────────────────────────────────────────────

def _box_centroid(box: List[List[float]]) -> Tuple[float, float]:
    """Compute centroid of a 4-point polygon."""
    pts = np.array(box, dtype=np.float32)
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


def sort_boxes_reading_order(boxes: List[List[List[float]]]) -> List[int]:
    """
    Sort bounding boxes in reading order (top→bottom, left→right).

    Returns list of original indices in sorted order.
    """
    if not boxes:
        return []

    centroids = [_box_centroid(b) for b in boxes]

    # Cluster into rows by y-centroid
    ys = np.array([c[1] for c in centroids])
    if len(ys) == 0:
        return []

    # Median line height for row grouping
    heights = []
    for b in boxes:
        pts = np.array(b, dtype=np.float32)
        heights.append(float(pts[:, 1].max() - pts[:, 1].min()))
    med_h = float(np.median(heights)) if heights else 20.0
    row_thresh = max(med_h * 0.5, 10.0)

    # Sort by y first
    order = sorted(range(len(centroids)), key=lambda i: centroids[i][1])

    # Group into rows
    rows: List[List[int]] = []
    current_row: List[int] = [order[0]]
    current_y = centroids[order[0]][1]

    for idx in order[1:]:
        cy = centroids[idx][1]
        if abs(cy - current_y) < row_thresh:
            current_row.append(idx)
        else:
            rows.append(current_row)
            current_row = [idx]
            current_y = cy
    rows.append(current_row)

    # Within each row sort by x
    result = []
    for row in rows:
        row.sort(key=lambda i: centroids[i][0])
        result.extend(row)

    return result


def align_boxes_with_transcript(
    boxes: List[List[List[float]]],
    lines: List[str],
) -> Tuple[List[Tuple[List[List[float]], str]], int, int]:
    """
    Align bounding boxes with transcript lines in reading order.

    Returns:
        (pairs, num_boxes, num_lines)
        where pairs = [(box, text), ...]
    """
    sorted_indices = sort_boxes_reading_order(boxes)
    sorted_boxes = [boxes[i] for i in sorted_indices]

    num_pairs = min(len(sorted_boxes), len(lines))
    pairs = [(sorted_boxes[i], lines[i]) for i in range(num_pairs)]

    return pairs, len(sorted_boxes), len(lines)


# ── Cropping ────────────────────────────────────────────────────────

def crop_line_image(
    image: np.ndarray,
    box: List[List[float]],
    padding: int = 4,
) -> np.ndarray:
    """
    Crop a text-line image from a page image using the bounding box.
    Adds small padding around the crop.
    """
    pts = np.array(box, dtype=np.float32)
    x_min, y_min = int(pts[:, 0].min()), int(pts[:, 1].min())
    x_max, y_max = int(pts[:, 0].max()), int(pts[:, 1].max())

    h, w = image.shape[:2]
    x1 = max(0, x_min - padding)
    y1 = max(0, y_min - padding)
    x2 = min(w, x_max + padding)
    y2 = min(h, y_max + padding)

    if x2 <= x1 or y2 <= y1:
        return np.zeros((1, 1, 3), dtype=np.uint8)

    return image[y1:y2, x1:x2].copy()


# ── Filename helper ─────────────────────────────────────────────────

def _safe_label(text: str, max_len: int = 30) -> str:
    """Create a filesystem-safe label from text (for filenames)."""
    safe = re.sub(r"[^\w\s-]", "", text)
    safe = re.sub(r"\s+", "_", safe.strip())
    return safe[:max_len] if safe else "line"


# ── Dataset Export ──────────────────────────────────────────────────

def build_dataset_zip(
    pages_data: List[Dict[str, Any]],
    book_name: str = "dataset",
) -> io.BytesIO:
    """
    Build a ZIP archive containing the OCR training dataset.

    pages_data: list of dicts, each with:
        - page_key: str (e.g. "page001")
        - image_data: str (base64 data-URL of the page image)
        - boxes: list of 4-point polygons
        - lines: list of transcript lines

    Returns a BytesIO containing the ZIP.
    """
    import base64

    buf = io.BytesIO()
    csv_rows: List[Tuple[str, str]] = []  # (image_path, text)

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for page in pages_data:
            page_key = page["page_key"]
            boxes = page["boxes"]
            lines = page["lines"]

            # Extract numeric page label for path naming
            page_num_match = re.search(r"(\d+)", str(page_key))
            page_dir = f"page_{int(page_num_match.group(1))}" if page_num_match else f"page_{page_key}"

            # Decode the page image
            img_b64 = page["image_data"]
            if "," in img_b64:
                img_b64 = img_b64.split(",", 1)[1]
            img_bytes = base64.b64decode(img_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                continue

            # Align
            pairs, _, _ = align_boxes_with_transcript(boxes, lines)
            seen_labels: Dict[str, int] = {}

            # Process each pair
            for idx, (box, text) in enumerate(pairs):
                crop = crop_line_image(img, box)
                label = _safe_label(text, max_len=80)
                count = seen_labels.get(label, 0) + 1
                seen_labels[label] = count
                label_with_suffix = label if count == 1 else f"{label}_{count}"

                img_filename = f"{book_name}/{page_dir}/{label_with_suffix}.png"

                # Encode crop to PNG
                _, png_data = cv2.imencode(".png", crop)
                zf.writestr(img_filename, png_data.tobytes())

                csv_rows.append((img_filename, text))

                # Release crop memory
                del crop

            # Release page image memory
            del img, nparr, img_bytes

        # Write simple global labels file (UTF-8 with BOM for broad compatibility)
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        writer.writerow(["image", "text"])
        for path, text in csv_rows:
            writer.writerow([path, text])
        csv_bytes = b'\xef\xbb\xbf' + csv_buf.getvalue().encode('utf-8')
        zf.writestr(f"{book_name}/labels.csv", csv_bytes)

    buf.seek(0)
    return buf
