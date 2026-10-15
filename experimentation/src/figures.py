"""Figures for the README and the notebooks. Every function returns matplotlib figure(s).

They run the app's real code (backend/preprocessing, layout_detection) on one
sample page, or read the outputs of scripts/evaluate.py. scripts/make_figures.py
saves them all to assets/.
"""

import difflib
import json
import os

import cv2
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Rectangle

from .corpus import LineCorpus
from .evaluation import CLEAN
from .paths import CHECKPOINTS, DATA
import app.services.layout_detection as ld
from preprocessing.operations import OP_REGISTRY as OPS

PAGE = str(DATA / "pages" / "PORCONES.23.5 - 1628" / "page1.png")
GT = str(DATA / "transcripts" / "PORCONES.23.5 - 1628 transcription" / "page1.txt")
EVAL = CHECKPOINTS / "eval"

# Validated categorical palette (blue, orange, aqua clear the CVD checks as a set),
# plus text and surface tokens. Text never takes a series colour.
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
RED, GREEN = "#e34948", "#008300"  # error highlights and box outlines on page images
GRAY, INK, INK_2, SURFACE = "#a9a8a3", "#1a1a19", "#52514e", "#ffffff"
MONO = "DejaVu Sans Mono"
sns.set_theme(style="whitegrid", context="notebook", font_scale=1.05, rc={
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": "#d9d8d4", "grid.color": "#ecebe7", "grid.linewidth": 1.0,
    "axes.titlesize": 13, "axes.titleweight": "semibold", "axes.titlelocation": "left", "axes.titlepad": 10,
    "text.color": INK, "axes.labelcolor": INK_2, "xtick.color": INK_2, "ytick.color": INK_2,
    "legend.frameon": False, "lines.linewidth": 2, "lines.solid_capstyle": "round", "savefig.dpi": 130})
PCT = matplotlib.ticker.FuncFormatter(lambda v, _: f"{v * 100:.4g}%")  # 0.025 -> "2.5%", 0.1 -> "10%"


def rgb(img):
    return cv2.cvtColor(img, cv2.COLOR_GRAY2RGB if img.ndim == 2 else cv2.COLOR_BGR2RGB)


def titled(ax, title, sub=""):
    """Bold title with a grey subtitle line (or lines) under it, left-aligned above the axes."""
    lines = sub.count("\n") + 1 if sub else 0
    ax.set_title(title, loc="left", pad=6 + 15 * lines)
    ax.text(0, 1.012, sub, transform=ax.transAxes, va="bottom", fontsize=10.5, color=INK_2, linespacing=1.3)


def draw_polys(ax, polys, color, lw=1.5):
    for p in polys:
        p = np.asarray(p, dtype=float)
        ax.add_patch(plt.Polygon(p, closed=True, fill=False, edgecolor=color, linewidth=lw))


# ── 1. Problem: an off-the-shelf OCR engine on the sample page ─────────

def tesseract_on_sample_page():
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = os.environ.get("TESSERACT_CMD", "tesseract")
    page = cv2.imread(PAGE)
    text = pytesseract.image_to_string(page, lang="spa")
    data = pytesseract.image_to_data(page, lang="spa", output_type=pytesseract.Output.DICT)

    gt_lines = [l.strip() for l in open(GT, encoding="utf-8") if l.strip()]
    ocr_lines = [l.strip() for l in text.splitlines() if l.strip()]

    # Pair each ground-truth line with its most similar Tesseract line.
    rows = []
    for g in gt_lines:
        best = max(ocr_lines, key=lambda o: difflib.SequenceMatcher(None, g, o).ratio())
        if difflib.SequenceMatcher(None, g, best).ratio() < 0.45:
            best = "(missing)"
        rows.append((g, best))

    fig = plt.figure(figsize=(17, 9.5))
    ax = fig.add_axes([0.0, 0.0, 0.36, 0.88])
    ax.imshow(rgb(page))
    for i, word in enumerate(data["text"]):
        if word.strip():
            ax.add_patch(Rectangle((data["left"][i], data["top"][i]), data["width"][i],
                                   data["height"][i], fill=False, edgecolor=RED, lw=1))
    titled(ax, "Tesseract 5 (Spanish)", "red boxes = the words it found")
    ax.axis("off")

    tx = fig.add_axes([0.38, 0.0, 0.62, 0.93])
    tx.axis("off")
    tx.text(0.0, 0.985, "Ground truth (scholar)", weight="semibold", fontsize=12, va="top", color=INK)
    tx.text(0.52, 0.985, "Tesseract output", weight="semibold", fontsize=12, va="top", color=INK)
    for k, (g, o) in enumerate(rows):
        y = 0.93 - k * 0.92 / len(rows)
        tx.text(0.0, y, g[:46], family=MONO, fontsize=10.5, va="center", color=INK_2)
        if o == "(missing)":
            tx.text(0.52, y, "— line missing —", fontsize=10.5, va="center", color=RED, style="italic")
        else:
            _diff_text(tx, 0.52, y, g, o[:46], size=10.5)
    fig.text(0.01, 0.995, "Modern OCR on a 1628 page: three out of four words wrong", fontsize=15,
             weight="semibold", va="top", color=INK)
    return fig


# ── 2. Preprocessing: what each operation does ─────────────────────────

# Region with real text, bleed-through from the reverse side and paper texture.
CROP = (slice(1860, 2700), slice(650, 2450))
def clean(img):
    """The PORCONES recipe (src.evaluation.CLEAN), applied with the app's own operations."""
    for step in CLEAN:
        img = OPS[step["op"]](img, step.get("params", {}))
    return img


def preprocessing_grid():
    page = cv2.imread(PAGE)
    crop = page[CROP]
    gray = OPS["grayscale"](crop, {})

    # Deskew needs a skewed input: tilt the crop 3 degrees, then let deskew fix it.
    h, w = gray.shape
    tilt = cv2.getRotationMatrix2D((w / 2, h / 2), 3, 1.0)
    skewed = cv2.warpAffine(gray, tilt, (w, h), borderMode=cv2.BORDER_REPLICATE)

    otsu = OPS["threshold"](gray, {"method": "otsu"})
    sauvola = OPS["threshold"](gray, {"method": "sauvola", "blockSize": 51, "k": 0.2})
    final = clean(crop)

    tiles = [
        (crop, "Original scan", "colour, bleed-through, paper texture"),
        (gray, "Grayscale", "colour carries no text information"),
        (OPS["normalize"](gray, {"strength": 100}), "Normalize", "stretch intensities to 0-255"),
        (skewed, "Skewed input (3° tilt)", "lines are not horizontal"),
        (OPS["deskew"](skewed, {"mode": "auto"}), "Deskew", "projection profile finds the angle"),
        (OPS["denoise"](gray, {"method": "nlm", "strength": 10}), "Denoise (NLM)", "averages similar patches"),
        (OPS["contrast"](gray, {}), "Contrast (CLAHE)", "local contrast (boosts bleed-through too)"),
        (OPS["sharpen"](gray, {"amount": 100}), "Sharpen", "unsharp mask on stroke edges"),
        (otsu, "Threshold: Otsu", "one global cut-off: drops faint bleed-through"),
        (sauvola, "Threshold: Sauvola", "local cut-off: good for uneven light,\nbut keeps bleed-through here"),
        (OPS["remove_noise"](otsu, {"maxArea": 20}), "Remove noise (on Otsu)", "drop specks < 20 px"),
        (final, "Full pipeline", "deskew → normalize → denoise → open → Otsu"),
    ]
    fig, axes = plt.subplots(4, 3, figsize=(16, 13))
    for ax, (img, title, sub) in zip(axes.flat, tiles):
        ax.imshow(rgb(img))
        titled(ax, title, sub)
        ax.axis("off")
    fig.tight_layout()
    return fig


# ── 3. Text detection: one stage vs two stages, and the merge steps ────

# Same detector resize settings the app uses.
DET_KW = dict(limit_side_len=ld.DET_LIMIT_SIDE_LEN, limit_type=ld.DET_LIMIT_TYPE,
              max_side_limit=ld.DET_MAX_SIDE_LIMIT)
LABEL_COLORS = {"text": GREEN, "paragraph_title": BLUE, "doc_title": BLUE,
                "header": BLUE, "image": ORANGE}


def _run_detection(page):
    """Single-stage boxes, layout regions, and every stage-2 intermediate."""
    os.environ.setdefault("FLAGS_enable_pir_api", "0")
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddlex import create_model

    det = create_model(model_name="PP-OCRv5_server_det", device="gpu")
    single = [np.asarray(p, float) for p in next(iter(det.predict(page, batch_size=1, **DET_KW)))["dt_polys"]]

    layout = ld.detect_layout(page, device="gpu", model_name="PP-DocLayout_plus-L")

    # Stage 2, mirroring ld.detect_text_lines: crop each text region, upscale
    # small ones, pad with white, detect, map boxes back to page coordinates.
    raw, scores = [], []
    H, W = page.shape[:2]
    for r in layout:
        if r["label"] not in ld.TEXT_LABELS:
            continue
        x1, y1, x2, y2 = r["bbox"]
        x1, y1 = max(0, x1 - ld.LAYOUT_EXPAND), max(0, y1 - ld.LAYOUT_EXPAND)
        x2, y2 = min(W, x2 + ld.LAYOUT_EXPAND), min(H, y2 + ld.LAYOUT_EXPAND)
        crop = page[y1:y2, x1:x2]
        sc = 2.0 if crop.shape[0] < ld.UPSCALE_MIN_H else 1.0
        if sc != 1.0:
            crop = cv2.resize(crop, None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC)
        pad = int(ld.REGION_PADDING * sc)
        crop = cv2.copyMakeBorder(crop, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        res = next(iter(det.predict(crop, batch_size=1, **DET_KW)))
        for poly, s in zip(res["dt_polys"], res["dt_scores"]):
            if s < ld.SCORE_THRESH:
                continue
            p = np.asarray(poly, np.float32) / sc
            p[:, 0] += x1 - ld.REGION_PADDING
            p[:, 1] += y1 - ld.REGION_PADDING
            raw.append(p)
            scores.append(float(s))
    del det

    kept = [raw[i] for i in ld._nms(raw, scores, ld.NMS_IOU_THRESH)]
    merged = ld._merge_into_lines(kept, W, H, ld.GAP_MULTIPLIER)
    final = ld._filter_boxes_by_page_size(merged, H, W)
    return single, layout, raw, kept, final


def _rows(boxes):
    """Re-derive the row grouping _merge_into_lines uses, for colouring."""
    b = [(p, p[:, 1].mean(), p[:, 1].max() - p[:, 1].min()) for p in boxes]
    thresh = 0.5 * float(np.median([h for _, _, h in b]))
    rows = []
    for p, cy, _ in sorted(b, key=lambda t: t[1]):
        for row in rows:
            if abs(cy - np.mean([q[1] for q in row])) < thresh:
                row.append((p, cy))
                break
        else:
            rows.append([(p, cy)])
    return [[p for p, _ in row] for row in rows]


def detection_steps():
    page = cv2.cvtColor(clean(cv2.imread(PAGE)), cv2.COLOR_GRAY2BGR)
    single, layout, raw, kept, final = _run_detection(page)
    print(f"single-stage {len(single)} | layout {len(layout)} | raw {len(raw)} "
          f"| after NMS {len(kept)} | lines {len(final)}")

    # Figure 3: one stage vs two stages, whole page.
    fig, axes = plt.subplots(1, 3, figsize=(18, 8.5))
    for ax in axes:
        ax.imshow(rgb(page))
        ax.axis("off")
    draw_polys(axes[0], single, RED, 1.5)
    titled(axes[0], "One stage: detector on the whole page",
           f"{len(single)} boxes: specks, shelf marks, woodcut, broken lines")
    for r in layout:
        x1, y1, x2, y2 = r["bbox"]
        c = LABEL_COLORS.get(r["label"], "gray")
        axes[1].add_patch(Rectangle((x1, y1), x2 - x1, y2 - y1, fill=False, edgecolor=c, lw=2.5))
        axes[1].text(x1, y1 - 25, r["label"], color="white", fontsize=9,
                     bbox=dict(facecolor=c, edgecolor="none", pad=1.5))
    titled(axes[1], "Stage 1: layout model finds regions", "text regions kept, images and margins dropped")
    draw_polys(axes[2], final, GREEN, 1.8)
    titled(axes[2], "Stage 2: detector inside text regions",
           f"+ merge = {len(final)} line boxes (ground truth: 17 lines)")
    fig.tight_layout()
    fig3 = fig

    # Figure 4: the merge steps, zoomed on the title block (spaced capitals).
    y0, y1 = 1430, 2190
    x0, x1 = 640, 2470
    zoom = page[y0:y1, x0:x1]
    inside = lambda polys: [p - [x0, y0] for p in polys
                            if y0 <= p[:, 1].mean() <= y1 and x0 <= p[:, 0].mean() <= x1]
    cmap = plt.get_cmap("tab10")
    fig, axes = plt.subplots(1, 3, figsize=(18, 4.6))
    for ax in axes:
        ax.imshow(rgb(zoom))
        ax.axis("off")
    r_in = inside(raw)
    for i, p in enumerate(r_in):
        draw_polys(axes[0], [p], cmap(i % 10), 2)
    titled(axes[0], f"1. Raw detector boxes ({len(r_in)})", "lines come back in pieces")
    for i, row in enumerate(_rows(inside(kept))):
        draw_polys(axes[1], row, cmap(i % 10), 2)
    titled(axes[1], "2. After NMS, group by row", "same colour = same line")
    f_in = inside(final)
    draw_polys(axes[2], f_in, GREEN, 2.2)
    titled(axes[2], f"3. Join the pieces of each row ({len(f_in)} lines)", "one box per line")
    fig.tight_layout()
    return fig3, fig


def iou_examples():
    """IoU explained: overlap / union, and when NMS drops a box."""
    cases = [((1, 1, 4, 3), (5, 1.5, 8, 3.5), "No overlap"),
             ((1, 1, 5, 3), (3.5, 1.4, 7.5, 3.4), "Small overlap"),
             ((1, 1, 5, 3), (1.4, 1.2, 5.3, 3.2), "Same line, detected twice")]
    fig, axes = plt.subplots(1, 3, figsize=(15, 3.6))
    for ax, (a, b, title) in zip(axes, cases):
        ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
        iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
        inter = ix * iy
        union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
        iou = inter / union
        for box, c in [(a, BLUE), (b, ORANGE)]:
            xy, w, h = (box[0], box[1]), box[2] - box[0], box[3] - box[1]
            ax.add_patch(Rectangle(xy, w, h, facecolor=c, alpha=0.12, edgecolor="none"))
            ax.add_patch(Rectangle(xy, w, h, fill=False, edgecolor=c, lw=2.5))
        if inter:
            ax.add_patch(Rectangle((max(a[0], b[0]), max(a[1], b[1])), ix, iy,
                                   facecolor="none", edgecolor=INK_2, hatch="////", lw=0))
        drop = iou > ld.NMS_IOU_THRESH
        ax.set_title(title, loc="center", pad=4)
        ax.text(4.25, 4.15, f"IoU = {iou:.2f}  →  " + ("drop the weaker box" if drop else "keep both"),
                ha="center", va="top", fontsize=12, color=INK, weight="semibold" if drop else "normal")
        ax.set_xlim(0, 8.5)
        ax.set_ylim(4.6, 0.5)
        ax.set_aspect("equal")
        ax.axis("off")
    fig.suptitle(f"IoU = overlap area ÷ combined area (hatched = overlap). Above {ld.NMS_IOU_THRESH}, "
                 "NMS keeps only the more confident box.", x=0.02, ha="left", y=0.99, fontsize=13)
    return fig


# ── 5. Text recognition: the CNN-BiLSTM (CRNN) model ───────────────────


def _cuboid(ax, x, y, w, h, d, face):
    """A 3-D block: front face w×h with lower-left corner (x, y), receding by d to the upper right."""
    dx, dy = d * 0.6, d * 0.45
    rgb_ = np.array(matplotlib.colors.to_rgb(face))
    edge = dict(edgecolor=tuple(rgb_ * 0.7), linewidth=0.8, joinstyle="round", zorder=4)
    ax.add_patch(plt.Polygon([(x, y + h), (x + dx, y + h + dy), (x + w + dx, y + h + dy), (x + w, y + h)],
                             facecolor=tuple(rgb_ + (1 - rgb_) * 0.45), **edge))
    ax.add_patch(plt.Polygon([(x + w, y), (x + w + dx, y + dy), (x + w + dx, y + h + dy), (x + w, y + h)],
                             facecolor=tuple(rgb_ * 0.8), **edge))
    ax.add_patch(Rectangle((x, y), w, h, facecolor=face, **edge))
    return x + w + dx  # right edge


def _arrow(ax, x0, x1, y):
    ax.add_patch(FancyArrowPatch((x0, y), (x1, y), arrowstyle="-|>", mutation_scale=17, lw=1.8,
                                 color=INK_2, shrinkA=0, shrinkB=0, zorder=6))


def _block_label(ax, cx, name, op, shape):
    ax.text(cx, 8.9, name, ha="center", va="top", fontsize=11.5, weight="semibold", color=INK)
    ax.text(cx, 7.5, op, ha="center", va="top", fontsize=9.5, color=INK_2, linespacing=1.35)
    ax.text(cx, 4.2, shape, ha="center", va="center", fontsize=9.5, family=MONO, color=INK,
            bbox=dict(boxstyle="round,pad=0.4,rounding_size=0.5", facecolor=SURFACE, edgecolor="#d9d8d4", lw=0.8))


def crnn_architecture():
    """Block diagram of the CRNN exactly as defined in backend/.../crnn_inference.py, with real tensor
    shapes (channels × height × width) and parameter counts from the trained checkpoint."""
    import torch

    state = torch.load(CHECKPOINTS / "crnn" / "best_crnn.pth", map_location="cpu", weights_only=False)["model_state_dict"]
    params = lambda prefix: sum(v.numel() for k, v in state.items()
                                if k.startswith(prefix) and "running_" not in k and "num_batches" not in k)
    classes = state["classifier.weight"].shape[0]

    fig = plt.figure(figsize=(22, 6.38))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 29)
    ax.axis("off")
    yc = 15.5  # vertical centre of the blocks

    panels = [(0.5, 11.6, "Input", "one detected line", "#f4f4f2", GRAY, "a crop from the\ntext detector"),
              (12.3, 55.0, "CNN feature extractor", f"ResNet · {params('cnn') / 1e6:.1f} M parameters", "#eef4fc",
               BLUE, "pooling shrinks the height 64 → 1, but the width only 4×:\none feature column per 4 px of the line"),
              (55.7, 74.5, "Sequence model", f"BiLSTM · {params('lstm') / 1e6:.1f} M parameters", "#ebf8f2", AQUA,
               "every column now sees the\nwhole line, in both directions"),
              (75.2, 99.5, "Output", f"Linear + CTC · {params('classifier') / 1e3:.0f} k parameters", "#fdf1eb",
               ORANGE, "trained with CTC loss: needs only the line's\ntext, not where each character is")]
    for x0, x1, title, sub, tint, accent, note in panels:
        ax.add_patch(FancyBboxPatch((x0, 0.5), x1 - x0, 28, boxstyle="round,pad=0,rounding_size=0.8",
                                    facecolor=tint, edgecolor="none", zorder=0))
        ax.add_patch(FancyBboxPatch((x0 + 0.9, 26.6), 0.75, 0.75, boxstyle="round,pad=0,rounding_size=0.2",
                                    facecolor=accent, edgecolor="none"))
        ax.text(x0 + 2.1, 27.0, title, va="center", fontsize=14, weight="semibold", color=INK)
        ax.text(x0 + 2.1, 25.6, sub, va="center", fontsize=10.5, color=INK_2)
        ax.text((x0 + x1) / 2, 1.9, note, ha="center", va="center", fontsize=10, color=INK_2, style="italic",
                linespacing=1.35)

    # Input: the start of a real line from a held-out book (the line continues, "…").
    line = cv2.imread(str(LineCorpus().root / "images/PADILLA 1 Nobleza Virtuosa 1637_p003_l004.png"),
                      cv2.IMREAD_GRAYSCALE)
    line = line[:, : int(line.shape[0] * 5.2)]
    w_img = 9.2
    h_img = w_img * line.shape[0] / line.shape[1]
    ax.imshow(line, cmap="gray", extent=(1.05, 1.05 + w_img, yc - h_img / 2, yc + h_img / 2), zorder=3)
    ax.add_patch(Rectangle((1.05, yc - h_img / 2), w_img, h_img, fill=False, edgecolor=INK_2, lw=0.8, zorder=4))
    ax.text(1.05 + w_img + 0.15, yc, "…", va="center", fontsize=14, color=INK_2)
    _block_label(ax, 6.05, "Line image", "grayscale, resized\nto height 64", "1 × 64 × W")
    w_img += 0.7
    right = 1.05 + w_img

    # CNN: front-face height ∝ log2(feature height), face width ∝ channels, depth ∝ feature width.
    stages = [("Conv stem", "3×3 conv\nBN, ReLU", 64, 64, "W", 1.0),
              ("Stage 1", "2 residual blocks\nmax-pool 2×2", 64, 32, "W/2", 0.5),
              ("Stage 2", "2 residual blocks\nmax-pool 2×2", 128, 16, "W/4", 0.25),
              ("Stage 3", "2 residual blocks\nmax-pool 2×1", 256, 8, "W/4", 0.25),
              ("Stage 4", "1 residual block\nmax-pool 2×1", 256, 4, "W/4", 0.25)]
    ramp = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"]
    slot = (55.0 - 12.3) / 6
    for i, ((name, op, ch, hgt, width, wfrac), col) in enumerate(zip(stages, ramp)):
        bw, bh, bd = 0.5 + ch / 200, 2.2 + 2.2 * np.log2(hgt / 4), 1.2 + 2.4 * wfrac
        cx = 12.3 + slot * (i + 0.5)
        x = cx - (bw + bd * 0.6) / 2
        _arrow(ax, right + 0.35, x - 0.15, yc)
        right = _cuboid(ax, x, yc - bh / 2, bw, bh, bd, col)
        _block_label(ax, cx, name, op, f"{ch} × {hgt} × {width}")

    # Height averaged away: a sequence of T = W/4 column vectors.
    cx = 12.3 + slot * 5.5
    xs = cx - 1.7 + np.arange(7) * 0.5
    _arrow(ax, right + 0.35, xs[0] - 0.15, yc)
    for xx in xs:
        ax.add_patch(FancyBboxPatch((xx, yc - 2.2), 0.36, 4.4, boxstyle="round,pad=0,rounding_size=0.12",
                                    facecolor=ramp[-1], edgecolor="none", zorder=4))
    _block_label(ax, cx, "Collapse height", "average over\nthe 4 rows", "T × 256,  T = W/4")
    right = xs[-1] + 0.36

    # BiLSTM: forward and backward rows of cells; two shadow cards show the 3 stacked layers.
    cx, cw, chh, step = 65.1, 2.0, 1.35, 3.15
    cells = cx - (3 * step + cw) / 2 + np.arange(4) * step
    card = (cells[0] - 0.6, yc - 2.65, cells[-1] + cw + 0.6 - (cells[0] - 0.6), 5.3)
    for k in (2, 1, 0):
        ax.add_patch(FancyBboxPatch((card[0] + 0.45 * k, card[1] + 0.45 * k), card[2], card[3],
                                    boxstyle="round,pad=0,rounding_size=0.5", facecolor=SURFACE,
                                    edgecolor="#9fd9c2" if k else AQUA, lw=1.0 if k else 1.4, zorder=3 - k))
    ax.text(card[0] + card[2] + 0.9, card[1] + card[3] + 0.9, "× 3 layers", ha="right", va="bottom",
            fontsize=10, weight="semibold", color=INK)
    _arrow(ax, right + 0.35, card[0] - 0.15, yc)
    for yy, forward in ((yc + 1.2, True), (yc - 1.2, False)):
        for xx in cells:
            ax.add_patch(FancyBboxPatch((xx, yy - chh / 2), cw, chh, boxstyle="round,pad=0,rounding_size=0.3",
                                        facecolor=AQUA, edgecolor="none", zorder=5))
            ax.text(xx + cw / 2, yy, "LSTM", ha="center", va="center", fontsize=8.5, color=SURFACE,
                    weight="semibold", zorder=6)
        for a, b in zip(cells, cells[1:]):
            s, e = (a + cw + 0.1, b - 0.1) if forward else (b - 0.1, a + cw + 0.1)
            ax.add_patch(FancyArrowPatch((s, yy), (e, yy), arrowstyle="-|>", mutation_scale=11, lw=1.2,
                                         color=INK_2, shrinkA=0, shrinkB=0, zorder=6))
    ax.text(cells[0], yc + 2.2, "forward →", fontsize=8.5, color=INK_2, va="center", zorder=6)
    ax.text(cells[-1] + cw, yc - 2.2, "← backward", fontsize=8.5, color=INK_2, va="center", ha="right", zorder=6)
    _block_label(ax, cx, "BiLSTM", "256 units each way,\nboth directions joined", "T × 512")
    right = card[0] + card[2] + 0.9

    # Linear + softmax: one probability column per time step (best symbol darkest).
    path = "-DD-oo-n-"
    symbols = ["-", "D", "o", "n", "a", "e"]
    rng = np.random.default_rng(3)
    probs = rng.random((len(symbols), len(path))) ** 4 * 0.3
    for c, s in enumerate(path):
        probs[symbols.index(s), c] = 0.9
    cell, gx = 0.62, 77.9
    gy = yc + len(symbols) * cell / 2
    cmap = sns.light_palette(ORANGE, as_cmap=True)
    _arrow(ax, right + 0.2, gx - 0.75, yc)
    for r, s in enumerate(symbols):
        ax.text(gx - 0.25, gy - (r + 0.5) * cell, "blank" if s == "-" else s, ha="right", va="center",
                fontsize=8, family=MONO, color=INK_2)
        for c in range(len(path)):
            ax.add_patch(Rectangle((gx + c * cell, gy - (r + 1) * cell), cell, cell,
                                   facecolor=cmap(probs[r, c]), edgecolor=SURFACE, lw=1.2, zorder=4))
    ax.text(gx + len(path) * cell / 2, gy + 0.45, "time step →", ha="center", va="bottom", fontsize=8.5, color=INK_2)
    _block_label(ax, gx + len(path) * cell / 2, "Linear + softmax",
                 f"probability of {classes - 1} chars\n+ blank, per column", f"T × {classes}")
    right = gx + len(path) * cell

    # Greedy CTC decoding.
    cx = 92.4
    _arrow(ax, right + 0.5, cx - 5.0, yc)
    for i, s in enumerate(path):
        ax.text(cx + (i - 4) * 1.0, yc + 2.3, "–" if s == "-" else s, ha="center", va="center", fontsize=16,
                family=MONO, color=GRAY if s == "-" else INK, weight="normal" if s == "-" else "semibold")
    ax.text(cx, yc + 0.95, "merge repeats, drop blanks", ha="center", va="center", fontsize=9.5, color=INK_2)
    ax.add_patch(FancyArrowPatch((cx, yc + 0.3), (cx, yc - 1.3), arrowstyle="-|>", mutation_scale=15, lw=1.6,
                                 color=INK_2, shrinkA=0, shrinkB=0))
    ax.text(cx, yc - 2.6, "Don", ha="center", va="center", fontsize=24, weight="bold", family=MONO, color=INK)
    _block_label(ax, cx, "Greedy CTC decoding", "best symbol per column,\nthen collapse", "text")
    return fig


# ── Recognition and post-processing (read scripts/evaluate.py outputs) ──

def _diff_text(ax, x, y, ref, hyp, size=11):
    """Write hyp in monospace at axes position (x, y); characters that differ from ref are red and bold."""
    from matplotlib.transforms import offset_copy
    ok = [False] * len(hyp)
    for tag, _, _, j1, j2 in difflib.SequenceMatcher(None, ref, hyp, autojunk=False).get_opcodes():
        if tag == "equal":
            ok[j1:j2] = [True] * (j2 - j1)
    adv = 0.6021 * size  # DejaVu Sans Mono advance width, in points
    for i, ch in enumerate(hyp):
        tr = offset_copy(ax.transAxes, fig=ax.figure, x=i * adv, units="points")
        ax.text(x, y, ch, transform=tr, family=MONO, fontsize=size, va="center",
                color=INK if ok[i] else RED, weight="normal" if ok[i] else "bold")


def predictions(name: str) -> dict:
    """Saved predictions of one model ("CRNN", "TrOCR + gemma", ...) from evaluate.py recognize/correct."""
    return json.loads((EVAL / f"{name.replace(' ', '_')}.json").read_text(encoding="utf-8"))


def results() -> dict:
    return json.loads((EVAL / "results.json").read_text(encoding="utf-8"))


def _header(fig, title, subtitle, top=0.86):
    """Left-aligned title and grey subtitle above the axes; the axes are laid out below `top`."""
    fig.tight_layout(rect=(0, 0, 1, top))
    fig.text(0.01, 0.995, title, ha="left", va="top", fontsize=15, weight="semibold", color=INK)
    fig.text(0.01, 0.995 - 0.075 * 4.6 / fig.get_figheight(), subtitle, ha="left", va="top", fontsize=11.5, color=INK_2)


def _legend(fig, colors: dict):
    handles = [matplotlib.patches.Patch(facecolor=c, label=name) for name, c in colors.items()]
    fig.legend(handles=handles, loc="upper right", bbox_to_anchor=(0.995, 1.0), ncol=len(handles),
               fontsize=11, handlelength=1.2, handleheight=1.0, columnspacing=1.6)


def training_curves(model: str):
    """Loss and validation error per epoch from checkpoints/<model>/history.json."""
    h = json.loads((CHECKPOINTS / model.lower() / "history.json").read_text())
    n = len(h["val_loss"])
    best = int(np.argmin(h["val_loss"] if model == "CRNN" else h["val_cer"]))
    splits = {"train": "train (23 books)", "val": "validation (3 unseen books)"}
    colors = {splits["train"]: BLUE, splits["val"]: ORANGE}
    df = pd.DataFrame([{"epoch": e + 1, "split": splits[s], "metric": m, "value": v}
                       for m in ("loss", "cer", "wer") for s in splits for e, v in enumerate(h.get(f"{s}_{m}", []))])
    marks = dict(marker="o", markersize=7, markeredgecolor=SURFACE, markeredgewidth=1.5) if n <= 15 else {}
    fig, axes = plt.subplots(1, 3, figsize=(17, 4.8))
    titles = {"loss": ("CTC" if model == "CRNN" else "Cross-entropy") + " loss (log scale)",
              "cer": "Character error rate", "wer": "Word error rate"}
    for ax, (metric, title) in zip(axes, titles.items()):
        sns.lineplot(df[df.metric == metric], x="epoch", y="value", hue="split", palette=colors, ax=ax,
                     legend=False, errorbar=None, **marks)
        ax.axvline(best + 1, color="#c9c8c2", lw=1, zorder=0)
        v = h[f"val_{metric}"][best]
        ax.scatter([best + 1], [v], s=80, color=ORANGE, edgecolor=SURFACE, linewidth=2, zorder=5)
        if metric == "loss":
            ax.set_yscale("log")
            ax.text(best + 1, 0.97, f" best epoch {best + 1}", transform=ax.get_xaxis_transform(),
                    fontsize=10, color=INK_2, va="top")
        else:
            ax.set_ylim(0, min(df[df.metric == metric].value.max() * 1.15, 6 * v))
            ax.yaxis.set_major_formatter(PCT)
            ax.annotate(f"best {v:.2%}", (best + 1, v), xytext=(16, 34), textcoords="offset points", ha="left",
                        fontsize=11, weight="semibold", color=INK, arrowprops=dict(arrowstyle="-", color=INK_2, lw=1),
                        bbox=dict(boxstyle="round,pad=0.25", facecolor=SURFACE, edgecolor="none"))
        ax.xaxis.set_major_locator(matplotlib.ticker.MaxNLocator(integer=True))
        ax.set(title=title, xlabel="epoch", ylabel="")
    sns.despine(fig, left=True)
    _header(fig, f"{model} training: best epoch {best + 1} of {n}",
            f"Early stopping on validation {'loss' if model == 'CRNN' else 'CER'}. "
            "Validation books are never seen in training.", top=0.83)
    _legend(fig, colors)
    return fig


def _barplot(ax, df: pd.DataFrame, colors: dict, title: str, fmt="{:.1%}"):
    sns.barplot(df, x="group", y="value", hue="model", palette=colors, ax=ax, width=0.66, saturation=1,
                edgecolor=SURFACE, linewidth=2, legend=False)
    for bars in ax.containers:
        ax.bar_label(bars, labels=[fmt.format(v) for v in bars.datavalues], padding=3, fontsize=10, color=INK)
    ax.yaxis.set_major_formatter(PCT)
    ax.margins(y=0.1)
    ax.set(title=title, xlabel="", ylabel="")
    ax.grid(axis="x", visible=False)


def recognition_comparison():
    """CRNN vs TrOCR: line-level CER by typeface, and line vs page-level WER (the cost of detection)."""
    from .metrics import cer

    _, val = LineCorpus().split()
    res = results()
    colors = {"CRNN": BLUE, "TrOCR": ORANGE}
    fonts = [("all", len(val))] + [(f, int((val["font"] == f).sum())) for f in ("roman", "gothic")]
    by_font = pd.DataFrame([{"model": m, "group": f"{font}\n{count} lines",
                             "value": cer([p for p, f in zip(predictions(m)["lines"], val["font"]) if font in ("all", f)],
                                          [t for t, f in zip(val["text"], val["font"]) if font in ("all", f)])}
                            for m in colors for font, count in fonts])
    levels = [("line", "single lines\n851"), ("page_raw", "full pages, raw scan\n28"),
              ("page_cleaned", "full pages, preprocessed\n28")]
    by_level = pd.DataFrame([{"model": m, "group": label, "value": res[m][key]["wer"]}
                             for m in colors for key, label in levels])
    fig, axes = plt.subplots(1, 2, figsize=(17, 5.2))
    _barplot(axes[0], by_font, colors, "Character error rate on lines, by typeface")
    _barplot(axes[1], by_level, colors, "Word error rate: lines vs full pages")
    sns.despine(fig, left=True)
    _header(fig, "CRNN vs TrOCR on the same held-out books",
            "Both trained on the same 23 books; tested on 3 others. On full pages, detection errors add up.")
    _legend(fig, colors)
    return fig


def recognition_samples(n: int = 3):
    """Validation lines read by both models: some perfect, some with errors (red)."""
    from .metrics import cer

    _, val = LineCorpus().split()
    crnn, trocr = predictions("CRNN")["lines"], predictions("TrOCR")["lines"]
    worst = [cer([c], [t]) + cer([r], [t]) for c, r, t in zip(crnn, trocr, val["text"])]
    rng = np.random.default_rng(7)
    perfect = [i for i, w in enumerate(worst) if w == 0]
    flawed = [i for i, w in enumerate(worst) if w > 0]
    picks = list(rng.choice(perfect, n, replace=False)) + list(rng.choice(flawed, n, replace=False))

    W, img_h, line_h, gap, head = 13.0, 0.5, 0.3, 0.42, 0.75  # inches
    block = img_h + 0.12 + 3 * line_h
    H = head + len(picks) * (block + gap)
    fig = plt.figure(figsize=(W, H))
    tx = fig.add_axes([0, 0, 1, 1])
    tx.axis("off")
    tx.set_xlim(0, W)
    tx.set_ylim(0, H)
    for k, i in enumerate(picks):
        top = H - head - k * (block + gap)
        img = cv2.imread(val["image"][i])
        ia = fig.add_axes([1.15 / W, (top - img_h) / H, 10.6 / W, img_h / H])
        ia.imshow(rgb(img))
        ia.set_anchor("W")
        ia.axis("off")
        tx.text(0.15, top - img_h / 2, f"{val['font'][i]}", fontsize=9.5, color=INK_2, va="center", style="italic")
        for r, (label, text) in enumerate((("truth", val["text"][i]), ("CRNN", crnn[i]), ("TrOCR", trocr[i]))):
            y = top - img_h - 0.12 - (r + 0.5) * line_h
            tx.text(0.15, y, label, fontsize=10, color=INK_2 if r == 0 else INK, va="center",
                    weight="normal" if r == 0 else "semibold")
            if r == 0:
                tx.text(1.15, y, text, family=MONO, fontsize=11, va="center", color=INK_2)
            else:
                _diff_text(tx, 1.15 / W, y / H, val["text"][i], text)
                e = cer([text], [val["text"][i]])
                tx.text(W - 0.15, y, "exact" if e == 0 else f"CER {e:.1%}", ha="right", va="center", fontsize=10,
                        color=INK_2)
        if k < len(picks) - 1:
            tx.plot([0.15, W - 0.15], [top - block - gap / 2] * 2, color="#e6e5e1", lw=1)
    tx.text(0.15, H - 0.12, "Validation lines from unseen books", fontsize=15, weight="semibold", va="top", color=INK)
    tx.text(0.15, H - 0.45, f"{n} read perfectly by both models, {n} with errors (in red)", fontsize=11.5,
            va="top", color=INK_2)
    return fig


def sample_page(model: str = "TrOCR", pipeline: str = "cleaned"):
    """The running example page end to end: detected lines and the model's text vs the truth."""
    from .evaluation import match_lines
    from .metrics import cer, wer
    from .pages import build_test_pages

    page = next(p for p in build_test_pages() if p.book.startswith("PORCONES") and p.name == "page1")
    boxes = json.loads(page.image.with_suffix(f".{pipeline}.boxes.json").read_text())
    got = predictions(model)["pages"][pipeline][f"{page.book}/{page.name}"]
    rows = list(zip(page.lines, match_lines(page.lines, got)))
    found = [(g, p) for g, p in rows if p is not None]
    fig = plt.figure(figsize=(17, 9.4))
    ax = fig.add_axes([0.0, 0.0, 0.34, 0.86])
    ax.imshow(rgb(cv2.imread(str(page.image))))
    draw_polys(ax, [np.asarray(b) for b in boxes], GREEN, 1.8)
    ax.set_xlim(500, 2600)
    ax.set_ylim(3700, 1150)
    ax.axis("off")
    tx = fig.add_axes([0.37, 0.0, 0.63, 0.86])
    tx.axis("off")
    tx.text(0.0, 0.99, "Ground truth", weight="semibold", fontsize=12, va="top", color=INK)
    tx.text(0.5, 0.99, f"{model} output", weight="semibold", fontsize=12, va="top", color=INK)
    for k, (g, p) in enumerate(rows):
        y = 0.93 - k * 0.9 / len(rows)
        tx.text(0.0, y, g[:44], family=MONO, fontsize=10.5, va="center", color=INK_2)
        if p is None:
            tx.text(0.5, y, "— line lost by detection —", fontsize=10.5, va="center", color=RED, style="italic")
        else:
            _diff_text(tx, 0.5, y, g, p[:44], size=10.5)
    text = " ".join(got)
    fig.text(0.01, 0.995, f"The sample page end to end: detection + {model}", fontsize=15, weight="semibold",
             va="top", color=INK)
    fig.text(0.01, 0.955, f"Page CER {cer([text], [page.text]):.1%}, WER {wer([text], [page.text]):.1%}.  "
             f"Detection lost {len(rows) - len(found)} of {len(rows)} lines (green boxes = detected lines); "
             f"on the lines it found, CER is {cer([p for _, p in found], [g for g, _ in found]):.1%}. "
             "Differences in red.", fontsize=11.5, va="top", color=INK_2)
    return fig


def quantization_tradeoff():
    """TrOCR at fp32/fp16/int8/4-bit: accuracy, memory and speed (checkpoints/trocr/quantization.csv)."""
    q = pd.read_csv(CHECKPOINTS / "trocr" / "quantization.csv", index_col=0)
    colors = {p: BLUE if p == "fp16" else "#c9c8c2" for p in q.index}
    fig, axes = plt.subplots(1, 3, figsize=(17, 4.2), sharey=True)
    for ax, (col, title, fmt) in zip(axes, [("cer", "Character error rate (lower is better)", "{:.2%}"),
                                            ("size_mb", "GPU memory (MB)", "{:,.0f}"),
                                            ("ms_per_line", "Time per line (ms, RTX 4060)", "{:.0f}")]):
        sns.barplot(x=q[col].values, y=q.index, hue=q.index, palette=colors, legend=False, ax=ax, orient="h",
                    width=0.62, saturation=1)
        for bars in ax.containers:
            ax.bar_label(bars, labels=[fmt.format(v) for v in bars.datavalues], padding=5, fontsize=10.5, color=INK)
        if col == "cer":
            ax.xaxis.set_major_formatter(PCT)
        ax.margins(x=0.16)
        ax.set(title=title, xlabel="", ylabel="")
        ax.grid(axis="y", visible=False)
        ax.tick_params(axis="y", labelsize=11.5)
    sns.despine(fig, left=True, bottom=True)
    _header(fig, "TrOCR at lower precision: same checkpoint, 851 validation lines",
            "Blue: fp16, what the app serves. Half the memory of fp32, 3× faster, same accuracy.", top=0.82)
    return fig


def postprocessing_gain():
    """LLM correction on the same 851 held-out lines: a big win on weak OCR, a loss on strong OCR."""
    res = results()
    inputs = {"Tesseract 5\n(weak OCR)": "Tesseract", "stock PaddleOCR\n(weak OCR)": "pairs paddle",
              "our CRNN": "CRNN", "our TrOCR": "TrOCR"}
    colors = {"OCR output": GRAY, "+ Gemma": BLUE, "+ Qwen": ORANGE}
    fig, axes = plt.subplots(1, 2, figsize=(19, 5.2))
    for ax, metric in zip(axes, ("cer", "wer")):
        df = pd.DataFrame([{"group": name, "model": label, "value": res[key + suffix]["line"][metric]}
                           for name, key in inputs.items()
                           for label, suffix in zip(colors, ("", " + gemma", " + qwen"))])
        _barplot(ax, df, colors, f"{'Character' if metric == 'cer' else 'Word'} error rate")
    sns.despine(fig, left=True)
    _header(fig, "LLM correction helps weak OCR and hurts strong OCR",
            "Fine-tuned Gemma-3-4B and Qwen3-4B correctors on 851 lines from 3 unseen books.")
    _legend(fig, colors)
    return fig
