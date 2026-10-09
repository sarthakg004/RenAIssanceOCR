"""Evaluate the recognizers, and the LLM correctors on top of them, on the shared test sets.

    python experimentation/scripts/evaluate.py detect          # cache line boxes for every test page
    python experimentation/scripts/evaluate.py recognize       # line + page predictions of every model
    python experimentation/scripts/evaluate.py recognize CRNN  # ...or only some (names from MODELS)
    python experimentation/scripts/evaluate.py correct gemma   # LLM-correct the new models' predictions
    python experimentation/scripts/evaluate.py correct qwen CRNN
    python experimentation/scripts/evaluate.py correct-pairs gemma  # ...and on the held-out pair data
    python experimentation/scripts/evaluate.py report          # metrics -> checkpoints/eval/results.json

Each step is its own process, so only one model holds the 8 GB GPU at a time.
Line level: the 851 validation lines (3 unseen books). Page level: 28 pages of unseen books.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.paths import CHECKPOINTS  # noqa: E402

OUT = CHECKPOINTS / "eval"
MODELS = {  # name -> (kind, checkpoint)
    "CRNN": ("crnn", CHECKPOINTS / "crnn" / "best_crnn.pth"),
    "TrOCR": ("trocr", CHECKPOINTS / "trocr"),
    "CRNN (previous)": ("crnn", CHECKPOINTS / "previous" / "crnn" / "best_crnn.pth"),
    "TrOCR (previous)": ("trocr", CHECKPOINTS / "previous" / "trocr"),
}
CORRECTORS = {  # name -> (base model, LoRA adapter)
    "gemma": ("google/gemma-3-4b-it", CHECKPOINTS / "postprocess" / "gemma-3-4b-it-lora"),
    "qwen": ("Qwen/Qwen3-4B-Instruct-2507", CHECKPOINTS / "postprocess" / "Qwen3-4B-Instruct-2507-lora"),
}


def _test_sets():
    from src.corpus import LineCorpus
    from src.pages import build_test_pages

    return LineCorpus().split()[1], build_test_pages()


def _file(name: str) -> Path:
    return OUT / f"{name.replace(' ', '_').replace('(', '').replace(')', '')}.json"


def detect():
    from src.evaluation import PIPELINES, PageDetector

    _, pages = _test_sets()
    for pipeline in PIPELINES:
        detector = PageDetector(pipeline)
        for page in pages:
            detector.boxes(page)
        print(f"{pipeline}: boxes cached for {len(pages)} pages")


def recognize(*names: str):
    from PIL import Image
    from src.evaluation import PIPELINES, PageDetector, Recognizer

    val, pages = _test_sets()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in names or MODELS:
        kind, path = MODELS[name]
        model = Recognizer(kind, path)
        result = {"lines": model.read([Image.open(p) for p in val["image"]]), "pages": {}}
        for pipeline in PIPELINES:
            detector = PageDetector(pipeline)
            result["pages"][pipeline] = {f"{p.book}/{p.name}": model.read_page(detector.image(p), detector.boxes(p))
                                         for p in pages}
        _file(name).write_text(json.dumps(result, ensure_ascii=False))
        print(f"{name}: predictions saved")
        del model


def correct(llm: str, *names: str):
    sys.path.insert(0, str(CHECKPOINTS.parents[1] / "backend"))
    from app.services.llm_processing.local_client import LocalCorrector

    base, adapter = CORRECTORS[llm]
    corrector = LocalCorrector(base, str(adapter))
    for name in names or ("CRNN", "TrOCR"):
        result = json.loads(_file(name).read_text())
        fixed = {"lines": corrector.correct_lines(result["lines"])[0], "pages": {}}
        for pipeline, pages in result["pages"].items():
            fixed["pages"][pipeline] = {k: corrector.correct_lines(v)[0] for k, v in pages.items()}
        _file(f"{name} + {llm}").write_text(json.dumps(fixed, ensure_ascii=False))
        print(f"{name} + {llm}: corrections saved")


def correct_pairs(llm: str):
    """The correctors on the held-out books' (OCR, truth) pairs: the noisy stock PaddleOCR
    output they were trained to fix, and the first CRNN's output."""
    sys.path.insert(0, str(CHECKPOINTS.parents[1] / "backend"))
    from app.services.llm_processing.local_client import LocalCorrector
    from src.llm_finetune import load_pairs, split_pairs

    corrector = LocalCorrector(*map(str, CORRECTORS[llm]))
    _, val = split_pairs(load_pairs())
    fixed = {src: corrector.correct_lines(list(d["ocr"]))[0] for src, d in val.groupby("source")}
    (OUT / f"pairs_{llm}.json").write_text(json.dumps(fixed, ensure_ascii=False))
    print(f"pairs + {llm}: corrections saved")


def report():
    from src.evaluation import PIPELINES, match_lines, scores

    val, pages = _test_sets()
    truth = {f"{p.book}/{p.name}": p for p in pages}
    results = {}
    for f in sorted(OUT.glob("*.json")):
        if f.name == "results.json" or f.name.startswith("pairs_"):
            continue
        pred = json.loads(f.read_text())
        row = {"line": scores(pred["lines"], list(val["text"])),
               "line_by_book": {b: scores([p for p, bb in zip(pred["lines"], val["book"]) if bb == b],
                                          list(val.loc[val["book"] == b, "text"])) for b in sorted(val["book"].unique())}}
        for pipeline in PIPELINES:
            got = pred["pages"][pipeline]
            keys = list(truth)
            row[f"page_{pipeline}"] = scores([" ".join(got[k]) for k in keys], [truth[k].text for k in keys])
            row[f"page_{pipeline}_by_book"] = {
                b: scores([" ".join(got[k]) for k in keys if truth[k].book == b],
                          [truth[k].text for k in keys if truth[k].book == b]) for b in sorted({p.book for p in pages})}
            # Separate detection from recognition: a ground-truth line with no
            # similar predicted line was lost (or mangled) by detection.
            found = [(p, g) for k in keys for g, p in zip(truth[k].lines, match_lines(truth[k].lines, got[k]))]
            hits = [(p, g) for p, g in found if p is not None]
            row[f"page_{pipeline}_found_lines"] = {**scores([p for p, _ in hits], [g for _, g in hits]),
                                                   "lost": len(found) - len(hits), "total": len(found)}
        results[f.stem.replace("_", " ")] = row
    from src.llm_finetune import load_pairs, split_pairs

    _, pairs = split_pairs(load_pairs())
    for f in sorted(OUT.glob("pairs_*.json")):
        fixed = json.loads(f.read_text())
        for src, d in pairs.groupby("source"):
            truth = list(d["gt"])
            results.setdefault(f"pairs {src}", {"line": scores(list(d["ocr"]), truth)})
            results[f"pairs {src} + {f.stem[6:]}"] = {"line": scores(fixed[src], truth)}
    (OUT / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))
    for name, r in results.items():
        print(f"{name:22s} line CER {r['line']['cer']:6.2%} WER {r['line']['wer']:6.2%} | "
              + " | ".join(f"page[{p}] CER {r[f'page_{p}']['cer']:6.2%} WER {r[f'page_{p}']['wer']:6.2%}"
                           for p in PIPELINES if f"page_{p}" in r))


if __name__ == "__main__":
    {"detect": detect, "recognize": recognize, "correct": correct, "correct-pairs": correct_pairs,
     "report": report}[sys.argv[1]](*sys.argv[2:])
