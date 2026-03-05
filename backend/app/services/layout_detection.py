"""
Layout-Aware PaddleOCR Text Line Detection Service.

Two-stage pipeline:
  1. Layout detection  ->  PPStructureV3 (PP-DocLayout_plus-L)
  2. Per-region OCR det ->  PaddleOCR (PP-OCRv5_server_det/rec)

Models are created fresh per call and cleaned up after,
matching the proven notebook implementation.
"""

import gc
import os
import time
from typing import List, Tuple

# Disable Paddle PIR to avoid ConvertPirAttribute2RuntimeAttribute errors
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"

import cv2
import numpy as np

import paddle
from paddleocr import PPStructureV3, PaddleOCR


# ---- constants (match working notebook) ----
TEXT_LABELS    = {"text", "paragraph_title", "doc_title", "header"}
REGION_PADDING = 50
LAYOUT_EXPAND  = 2
SCORE_THRESH   = 0.5
UPSCALE_MIN_H  = 60
NMS_IOU_THRESH = 0.3
GAP_MULTIPLIER = 2.0


# ==============================================================
# Layout Detection Helpers
# ==============================================================

def _resize_for_layout(image: np.ndarray,
                       max_side: int = 1500) -> Tuple[np.ndarray, float]:
    h, w = image.shape[:2]
    mx = max(h, w)
    if mx <= max_side:
        return image, 1.0
    s = max_side / mx
    return cv2.resize(image, (int(w * s), int(h * s)),
                      interpolation=cv2.INTER_AREA), s


def _box_area(box):
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _iou_xyxy(a, b):
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    return inter / float(_box_area(a) + _box_area(b) - inter)


def _suppress_overlapping(layout_boxes, iou_thresh=0.3):
    filtered = []
    for box in layout_boxes:
        keep = True
        for kept in filtered:
            if box["label"] != kept["label"]:
                continue
            if _iou_xyxy(box["bbox"], kept["bbox"]) > iou_thresh:
                if _box_area(box["bbox"]) < _box_area(kept["bbox"]):
                    filtered.remove(kept)
                else:
                    keep = False
                break
        if keep:
            filtered.append(box)
    return filtered


def _remove_margin_boxes(layout_boxes, page_width):
    out = []
    for b in layout_boxes:
        x1, _, x2, _ = b["bbox"]
        cx = (x1 + x2) / 2
        if cx < page_width * 0.12 or cx > page_width * 0.88:
            continue
        out.append(b)
    return out


def _merge_title_blocks(layout_boxes, vertical_thresh=70):
    merged = []
    for label in ("doc_title", "text"):
        boxes = sorted(
            [b for b in layout_boxes if b["label"] == label],
            key=lambda x: x["bbox"][1],
        )
        cur = None
        for b in boxes:
            if cur is None:
                cur = b.copy(); continue
            if b["bbox"][1] - cur["bbox"][3] < vertical_thresh:
                cur["bbox"] = [
                    min(cur["bbox"][0], b["bbox"][0]),
                    min(cur["bbox"][1], b["bbox"][1]),
                    max(cur["bbox"][2], b["bbox"][2]),
                    max(cur["bbox"][3], b["bbox"][3]),
                ]
            else:
                merged.append(cur); cur = b.copy()
        if cur:
            merged.append(cur)
    for b in layout_boxes:
        if b["label"] not in ("doc_title", "text"):
            merged.append(b)
    return merged


# ==============================================================
# Text-Line Detection Helpers
# ==============================================================

def _poly_bounds(poly):
    pts = np.asarray(poly, dtype=np.float32)
    xmn, ymn = pts[:, 0].min(), pts[:, 1].min()
    xmx, ymx = pts[:, 0].max(), pts[:, 1].max()
    return xmn, ymn, xmx, ymx, (xmn+xmx)*0.5, (ymn+ymx)*0.5, xmx-xmn, ymx-ymn


def _nms(boxes, scores, iou_thresh=NMS_IOU_THRESH):
    if not boxes:
        return []
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    keep, suppressed = [], set()
    for i in order:
        if i in suppressed:
            continue
        keep.append(i)
        bi = _poly_bounds(boxes[i])[:4]
        for j in order:
            if j in suppressed or j == i:
                continue
            bj = _poly_bounds(boxes[j])[:4]
            if _iou_xyxy(bi, bj) > iou_thresh:
                suppressed.add(j)
    return keep


def _resolve_vertical_overlaps(boxes, thresh=0.30):
    if len(boxes) < 2:
        return boxes
    rects = [
        [float(b[:, 0].min()), float(b[:, 1].min()),
         float(b[:, 0].max()), float(b[:, 1].max())]
        for b in boxes
    ]
    order = sorted(range(len(rects)), key=lambda i: rects[i][1])
    rects = [rects[i] for i in order]
    for i in range(len(rects)):
        yi0, yi1 = rects[i][1], rects[i][3]
        hi = yi1 - yi0
        if hi <= 0:
            continue
        for j in range(i + 1, len(rects)):
            yj0, yj1 = rects[j][1], rects[j][3]
            ov_top, ov_bot = max(yi0, yj0), min(yi1, yj1)
            ov = ov_bot - ov_top
            if ov <= 0:
                break
            hj = yj1 - yj0
            if hj <= 0:
                continue
            if ov / min(hi, hj) > thresh:
                mid = (ov_top + ov_bot) / 2.0
                rects[i][3] = mid
                rects[j][1] = mid
                yi1 = mid
    result = []
    for r in rects:
        xmn, ymn, xmx, ymx = r
        if xmx > xmn and ymx > ymn:
            result.append(np.array(
                [[xmn, ymn], [xmx, ymn], [xmx, ymx], [xmn, ymx]],
                dtype=np.float32,
            ))
    return result


def _merge_into_lines(raw_boxes, img_w, img_h, gap_multiplier=GAP_MULTIPLIER):
    if not raw_boxes:
        return []
    bounds = [_poly_bounds(b) for b in raw_boxes]
    heights = np.array([b[7] for b in bounds], dtype=np.float32)
    widths  = np.array([b[6] for b in bounds], dtype=np.float32)
    med_h = float(np.median(heights))
    med_w = float(np.median(widths))
    h_thresh  = 0.5 * med_h
    gap_limit = gap_multiplier * med_w
    MIN_W, MIN_H, MAX_H = 10.0, 10.0, 3.0 * med_h

    filtered = [
        (b, bnd) for b, bnd in zip(raw_boxes, bounds)
        if bnd[6] >= MIN_W and MIN_H <= bnd[7] <= MAX_H
    ]
    if not filtered:
        return []
    filtered.sort(key=lambda x: x[1][5])

    lines = []
    for box, bnd in filtered:
        cy = bnd[5]
        assigned = False
        for line in lines:
            line_cy = sum(b[1][5] for b in line) / len(line)
            if abs(cy - line_cy) < h_thresh:
                line.append((box, bnd))
                assigned = True
                break
        if not assigned:
            lines.append([(box, bnd)])

    merged = []
    for line in lines:
        line.sort(key=lambda x: x[1][0])
        groups = [[line[0]]]
        for item in line[1:]:
            if item[1][0] - groups[-1][-1][1][2] <= gap_limit:
                groups[-1].append(item)
            else:
                groups.append([item])
        for grp in groups:
            xmn = max(0, min(b[1][0] for b in grp))
            ymn = max(0, min(b[1][1] for b in grp))
            xmx = min(img_w, max(b[1][2] for b in grp))
            ymx = min(img_h, max(b[1][3] for b in grp))
            if xmx > xmn and ymx > ymn:
                merged.append(np.array(
                    [[xmn, ymn], [xmx, ymn], [xmx, ymx], [xmn, ymx]],
                    dtype=np.float32,
                ))

    merged = _resolve_vertical_overlaps(merged)
    merged.sort(key=lambda b: (float(b[:, 1].min()), float(b[:, 0].min())))
    return merged


def _filter_boxes_by_page_size(boxes, img_h, img_w, min_area_fraction=0.0001):
    page_area = img_h * img_w
    min_area = min_area_fraction * page_area
    kept = []
    for box in boxes:
        pts = np.asarray(box, dtype=np.float32)
        w = float(pts[:, 0].max() - pts[:, 0].min())
        h = float(pts[:, 1].max() - pts[:, 1].min())
        if w * h >= min_area:
            kept.append(box)
    return kept


# ==============================================================
# Core Detection (fresh models per call, matching notebook)
# ==============================================================

def detect_layout(image: np.ndarray, device: str = "gpu",
                  max_layout_side: int = 1500,
                  model_name: str = "PP-DocLayout_plus-L") -> list:
    """Run layout detection and return cleaned layout boxes."""
    resized, scale = _resize_for_layout(image, max_layout_side)

    print(f"[detect_layout] image={image.shape}, resized={resized.shape}, "
          f"scale={scale:.3f}, model={model_name}, device={device}")

    pipeline = PPStructureV3(
        layout_detection_model_name=model_name,
        device=device,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_table_recognition=False,
        use_formula_recognition=False,
        use_chart_recognition=False,
        use_seal_recognition=False,
        use_region_detection=False,
    )

    results = pipeline.predict(input=resized)

    layout_boxes = []
    for res in results:
        for b in res["layout_det_res"]["boxes"]:
            label = b["label"]
            score = float(b["score"])
            x1, y1, x2, y2 = b["coordinate"]
            layout_boxes.append({
                "label": label,
                "bbox": [int(x1 / scale), int(y1 / scale),
                         int(x2 / scale), int(y2 / scale)],
                "score": score,
            })

    print(f"[detect_layout] raw layout boxes: {len(layout_boxes)}")
    for b in layout_boxes:
        print(f"  {b['label']:20s}  score={b['score']:.2f}  bbox={b['bbox']}")

    layout_boxes = _suppress_overlapping(layout_boxes)
    layout_boxes = _remove_margin_boxes(layout_boxes, image.shape[1])
    layout_boxes = _merge_title_blocks(layout_boxes)

    print(f"[detect_layout] after post-processing: {len(layout_boxes)} boxes")

    # Cleanup — free GPU memory
    del pipeline, results
    gc.collect()

    return layout_boxes


def detect_text_lines(image: np.ndarray, layout: list,
                      device: str = "gpu",
                      det_model_name: str = "PP-OCRv5_server_det",
                      region_padding: int = REGION_PADDING,
                      layout_expand: int = LAYOUT_EXPAND,
                      score_thresh: float = SCORE_THRESH,
                      upscale_min_h: int = UPSCALE_MIN_H,
                      nms_iou_thresh: float = NMS_IOU_THRESH,
                      gap_multiplier: float = GAP_MULTIPLIER) -> list:
    """Detect line-level bounding boxes for all text regions."""

    print(f"[detect_text_lines] image={image.shape}, "
          f"{len(layout)} layout regions, det_model={det_model_name}")

    ocr = PaddleOCR(
        text_detection_model_name=det_model_name,
        text_recognition_model_name="PP-OCRv5_server_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device=device,
        lang="en",
    )

    img_h, img_w = image.shape[:2]
    all_raw, all_scores = [], []

    for region in layout:
        if region["label"] not in TEXT_LABELS:
            continue
        x1, y1, x2, y2 = [int(c) for c in region["bbox"]]
        x1e = max(0, x1 - layout_expand)
        y1e = max(0, y1 - layout_expand)
        x2e = min(img_w, x2 + layout_expand)
        y2e = min(img_h, y2 + layout_expand)
        if x2e <= x1e or y2e <= y1e:
            continue

        crop = image[y1e:y2e, x1e:x2e]
        if crop.size == 0:
            continue

        sc = 1.0
        if crop.shape[0] < upscale_min_h:
            sc = 2.0
            crop = cv2.resize(crop, None, fx=sc, fy=sc,
                              interpolation=cv2.INTER_CUBIC)

        pad_scaled = int(region_padding * sc)
        padded = cv2.copyMakeBorder(
            crop, pad_scaled, pad_scaled, pad_scaled, pad_scaled,
            borderType=cv2.BORDER_CONSTANT, value=(255, 255, 255),
        )
        del crop

        ox = x1e - region_padding
        oy = y1e - region_padding

        crop_results = ocr.predict(padded)
        del padded

        n = 0
        for res in crop_results:
            polys  = res.get("dt_polys",  [])
            scores = res.get("dt_scores", [1.0] * len(polys))
            for poly, score in zip(polys, scores):
                if score < score_thresh:
                    continue
                arr = np.array(poly, dtype=np.float32)
                arr /= sc
                arr[:, 0] += ox
                arr[:, 1] += oy
                if arr[:, 0].max() < x1e or arr[:, 0].min() > x2e:
                    continue
                if arr[:, 1].max() < y1e or arr[:, 1].min() > y2e:
                    continue
                all_raw.append(arr)
                all_scores.append(float(score))
                n += 1
        del crop_results

        print(f"  [{region['label']}]  bbox={region['bbox']}  "
              f"scale={sc:.1f}x  ->  {n} raw boxes")

    print(f"[detect_text_lines] total raw boxes: {len(all_raw)}")

    # NMS dedup
    keep_idx = _nms(all_raw, all_scores, iou_thresh=nms_iou_thresh)
    all_raw = [all_raw[i] for i in keep_idx]
    print(f"[detect_text_lines] after NMS: {len(all_raw)}")

    # Merge to lines
    merged = _merge_into_lines(all_raw, img_w, img_h, gap_multiplier=gap_multiplier)
    del all_raw

    before = len(merged)
    merged = _filter_boxes_by_page_size(merged, img_h, img_w)
    print(f"[detect_text_lines] after page filter: {len(merged)} "
          f"(removed {before - len(merged)})")

    # Cleanup
    del ocr
    gc.collect()

    return merged


# ==============================================================
# Public Orchestrator
# ==============================================================

def run_layout_aware_detection(
    image: np.ndarray,
    use_gpu: bool = False,
    layout_model_name: str = "PP-DocLayout_plus-L",
    det_model_name: str = "PP-OCRv5_server_det",
    region_padding: int = REGION_PADDING,
    layout_expand: int = LAYOUT_EXPAND,
    score_thresh: float = SCORE_THRESH,
    upscale_min_h: int = UPSCALE_MIN_H,
    nms_iou_thresh: float = NMS_IOU_THRESH,
    gap_multiplier: float = GAP_MULTIPLIER,
) -> List[List[List[float]]]:
    """
    Full pipeline: layout detection -> text line detection.
    Returns list of 4-point polygons in page coordinates.
    """
    device = "gpu" if use_gpu else "cpu"
    print(f"\n{'='*60}")
    print(f"[run_layout_aware_detection] START")
    print(f"  image shape : {image.shape}")
    print(f"  device      : {device}")
    print(f"  layout_model: {layout_model_name}")
    print(f"  det_model   : {det_model_name}")
    print(f"  region_padding : {region_padding}")
    print(f"  layout_expand  : {layout_expand}")
    print(f"  score_thresh   : {score_thresh}")
    print(f"  upscale_min_h  : {upscale_min_h}")
    print(f"  nms_iou_thresh : {nms_iou_thresh}")
    print(f"  gap_multiplier : {gap_multiplier}")
    print(f"{'='*60}")

    t0 = time.time()

    # Stage 1
    layout = detect_layout(image, device=device, max_layout_side=1500,
                           model_name=layout_model_name)

    if not layout:
        print("[run_layout_aware_detection] No layout regions found!")
        return []

    text_regions = [r for r in layout if r["label"] in TEXT_LABELS]
    print(f"\n[run_layout_aware_detection] "
          f"{len(text_regions)} text regions / {len(layout)} total")

    if not text_regions:
        print("[run_layout_aware_detection] No TEXT regions in layout!")
        return []

    # Stage 2
    merged = detect_text_lines(image, layout, device=device,
                               det_model_name=det_model_name,
                               region_padding=region_padding,
                               layout_expand=layout_expand,
                               score_thresh=score_thresh,
                               upscale_min_h=upscale_min_h,
                               nms_iou_thresh=nms_iou_thresh,
                               gap_multiplier=gap_multiplier)

    lines = [box.tolist() for box in merged]

    elapsed = time.time() - t0
    print(f"\n[run_layout_aware_detection] DONE — "
          f"{len(lines)} lines in {elapsed:.1f}s")

    gc.collect()
    if paddle.device.is_compiled_with_cuda():
        paddle.device.cuda.empty_cache()

    return lines
