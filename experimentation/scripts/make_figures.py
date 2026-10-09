"""Save every README figure to assets/ (the figures themselves live in src/figures.py).

Run from the repo root with the experiment env, after scripts/evaluate.py:

    TESSERACT_CMD=/path/to/tesseract TESSDATA_PREFIX=/path/to/tessdata \\
        python experimentation/scripts/make_figures.py          # all figures
    python experimentation/scripts/make_figures.py detection    # just some

On an 8 GB GPU run "detection" on its own: Paddle keeps its memory pool until exit.
"""

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import figures  # noqa: E402
from src.paths import ASSETS  # noqa: E402

FIGURES = {  # name -> (function, output file(s))
    "ocr": (figures.tesseract_on_sample_page, ["01_tesseract_fails.png"]),
    "preprocessing": (figures.preprocessing_grid, ["02_preprocessing_grid.png"]),
    "detection": (figures.detection_steps, ["03_one_vs_two_stage.png", "04_merge_steps.png"]),
    "iou": (figures.iou_examples, ["05_iou.png"]),
    "crnn_architecture": (figures.crnn_architecture, ["06_crnn_architecture.png"]),
    "crnn_training": (lambda: figures.training_curves("CRNN"), ["07_crnn_training.png"]),
    "trocr_training": (lambda: figures.training_curves("TrOCR"), ["08_trocr_training.png"]),
    "recognition": (figures.recognition_comparison, ["09_recognition_comparison.png"]),
    "samples": (figures.recognition_samples, ["10_recognition_samples.png"]),
    "sample_page": (figures.sample_page, ["11_sample_page.png"]),
    "quantization": (figures.quantization_tradeoff, ["12_trocr_quantization.png"]),
    "postprocessing": (figures.postprocessing_gain, ["13_postprocessing_gain.png"]),
}

if __name__ == "__main__":
    for name in sys.argv[1:] or FIGURES:
        make, files = FIGURES[name]
        out = make()
        for fig, file in zip(out if isinstance(out, tuple) else (out,), files):
            fig.savefig(ASSETS / file, bbox_inches="tight")
            plt.close(fig)
            print("wrote assets/" + file)
