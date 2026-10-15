# Experimentation

Everything behind the models the app ships: data, training, evaluation and the figures in the
main README. The notebooks are the readable, step-by-step story; `src/` holds the code they
call; `scripts/` runs the long jobs in their own processes (one model on the 8 GB GPU at a time).

| Notebook | What it shows |
|---|---|
| `01_full_pipeline.ipynb` | One page through all four stages: preprocess → detect → recognise → LLM-correct |
| `02_preprocessing.ipynb` | Every OpenCV operation, Otsu vs Sauvola, piecewise deskew, the PORCONES recipe |
| `03_text_detection.ipynb` | Two-stage detection, line merging (NMS, IoU), memory, the detector fine-tune experiment |
| `04_text_recognition.ipynb` | CRNN and TrOCR on the same split: training, line and page CER/WER, quantization |
| `05_llm_postprocessing.ipynb` | QLoRA fine-tuning of Gemma-3-4B and Qwen3-4B, before/after correction |

Preprocessing, detection and inference are **imported from the app** (`backend/`), so the
notebooks measure exactly what the app runs. `src/` adds only what the app does not need:

| Module | Purpose |
|---|---|
| `corpus.py` | The 3,807-line corpus (HuggingFace) and the book-level split every experiment uses |
| `crnn.py`, `trocr.py` | Training (and TrOCR quantization benchmark) |
| `pages.py` | The page-level test set: 28 transcribed pages from unseen books, rendered from the PDFs |
| `evaluation.py` | App-identical page detection (cached) and recognition, plus CER/WER |
| `llm_finetune.py` | QLoRA fine-tuning of the LLM correctors |
| `figures.py` | Every figure; `scripts/make_figures.py` saves them to `../assets/` |

## Reproduce

```bash
pip install -r experimentation/requirements.txt         # see the file for GPU wheels
python experimentation/scripts/train.py crnn             # ~1.5 h on an RTX 4060
python experimentation/scripts/train.py trocr            # ~2.5 h
python experimentation/scripts/evaluate.py detect        # cache line boxes for the test pages
python experimentation/scripts/evaluate.py recognize     # Tesseract: set TESSERACT_CMD, TESSDATA_PREFIX
python experimentation/scripts/evaluate.py correct gemma # needs HF_TOKEN (gated base model)
python experimentation/scripts/evaluate.py correct qwen
python experimentation/scripts/evaluate.py correct-pairs gemma  # the stock PaddleOCR row
python experimentation/scripts/evaluate.py correct-pairs qwen
python experimentation/scripts/evaluate.py report        # -> checkpoints/eval/results.json
python experimentation/scripts/make_figures.py           # -> assets/
```

`data/` (PDFs, transcripts, fine-tuning pairs) and `checkpoints/` are not in git. The line
corpus downloads from HuggingFace on first use. To ship retrained recognizers, copy
`checkpoints/crnn/best_crnn.pth` and `checkpoints/trocr/` into `backend/models/weights/` and
upload them to the Google Drive folder CI builds the images from.
