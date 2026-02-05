# line_detector.py
import cv2
import numpy as np
from shapely.geometry import Polygon, box
from craft_text_detection import craft_detector  # pip package: craft-text-detection
from craft_text_detection import imgproc

def get_bboxes_and_polys_from_craft(image):
    """
    Run CRAFT detector (using craft-text-detection wrapper).
    Returns:
        boxes: list of axis-aligned bounding boxes [x_min, y_min, x_max, y_max]
        polys: list of polygons (list of (x,y) tuples)
    """
    # craft_detector.detect_text returns bboxes, polys, heatmap
    bboxes, polys, _ = craft_detector.detect_text(image)
    boxes = []
    poly_list = []
    for p in polys:
        # p is list of [x,y] pairs
        poly = [(int(x), int(y)) for (x, y) in p]
        poly_list.append(poly)
        xs = [pt[0] for pt in poly]
        ys = [pt[1] for pt in poly]
        boxes.append([min(xs), min(ys), max(xs), max(ys)])
    return boxes, poly_list

def group_boxes_to_lines(boxes, polys, y_overlap_threshold=0.6, x_gap_ratio=0.5):
    """
    Simple greedy grouping of boxes to text lines.
    - boxes: list of [x_min, y_min, x_max, y_max]
    - polys: list of corresponding polygons
    Returns:
      lines: list of dicts { 'polys': [poly,...], 'bbox': [xmin,ymin,xmax,ymax'] }
    """
    # compute row center and height for each box
    items = []
    for i, b in enumerate(boxes):
        xmin,ymin,xmax,ymax = b
        h = ymax - ymin + 1
        cy = (ymin + ymax) / 2.0
        items.append({'idx': i, 'xmin': xmin, 'xmax': xmax, 'ymin': ymin, 'ymax': ymax, 'cy': cy, 'h': h})
    # sort by center y (top to bottom)
    items = sorted(items, key=lambda x: x['cy'])

    lines = []
    for it in items:
        placed = False
        for ln in lines:
            # compare vertical proximity: overlap ratio between box and line bbox in y
            line_ymin = ln['bbox'][1]
            line_ymax = ln['bbox'][3]
            inter_ymin = max(line_ymin, it['ymin'])
            inter_ymax = min(line_ymax, it['ymax'])
            inter_h = max(0, inter_ymax - inter_ymin)
            # ratio of vertical overlap relative to height of this box
            if it['h'] > 0 and (inter_h / it['h']) >= y_overlap_threshold:
                # also check x-overlap or closeness (to avoid stacking different columns together)
                # allow grouping if x spans overlap or distance is small relative to avg width
                line_xmin, _, line_xmax, _ = ln['bbox']
                # gap distance
                gap = max(0, it['xmin'] - line_xmax, line_xmin - it['xmax'])
                avg_w = max(1, (it['xmax'] - it['xmin'] + line_xmax - line_xmin)/2.0)
                if gap <= avg_w * x_gap_ratio:
                    # add to this line
                    ln['indices'].append(it['idx'])
                    # update bbox
                    ln['bbox'][0] = min(ln['bbox'][0], it['xmin'])
                    ln['bbox'][1] = min(ln['bbox'][1], it['ymin'])
                    ln['bbox'][2] = max(ln['bbox'][2], it['xmax'])
                    ln['bbox'][3] = max(ln['bbox'][3], it['ymax'])
                    placed = True
                    break
        if not placed:
            # create new line
            lines.append({'indices': [it['idx']], 'bbox': [it['xmin'], it['ymin'], it['xmax'], it['ymax']]})

    # convert lines to polygon unions (optional)
    results = []
    for ln in lines:
        line_polys = [polys[i] for i in ln['indices']]
        # union of polygons via shapely to get a single polygon
        shapely_polys = [Polygon(p) for p in line_polys if len(p) >= 3]
        if len(shapely_polys) == 0:
            union_poly = None
        else:
            union = shapely_polys[0]
            for sp in shapely_polys[1:]:
                union = union.union(sp)
            union_poly = union
        results.append({
            'indices': ln['indices'],
            'bbox': ln['bbox'],
            'poly': union_poly  # shapely polygon (can .exterior.coords)
        })
    return results

def detect_lines_from_image(image_path, debug_draw=False):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Cannot read image: " + image_path)
    # Optionally: preprocessed image input already (grayscale/denoised) — craft works with color images too.
    boxes, polys = get_bboxes_and_polys_from_craft(img)
    lines = group_boxes_to_lines(boxes, polys)
    if debug_draw:
        out = img.copy()
        # draw all boxes
        for b in boxes:
            x1,y1,x2,y2 = b
            cv2.rectangle(out, (x1,y1), (x2,y2), (0,255,0), 1)
        # draw lines as red rectangles
        for ln in lines:
            x1,y1,x2,y2 = map(int, ln['bbox'])
            cv2.rectangle(out, (x1,y1), (x2,y2), (0,0,255), 2)
        cv2.imshow("det", out)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    return lines

if __name__ == "__main__":
    import sys
    img_path = sys.argv[1]
    lines = detect_lines_from_image(img_path, debug_draw=True)
    print("Detected", len(lines), "lines")
    for i,ln in enumerate(lines):
        print(i, "bbox:", ln['bbox'], "num parts:", len(ln['indices']))
