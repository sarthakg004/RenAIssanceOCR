"""Normalize a TrOCR checkpoint for transformers 4.44.x + tokenizers 0.19.x.

The shipped checkpoint at backend/models/weights/trocr/ contains only the
fine-tuned artifacts (config.json, generation_config.json, model.safetensors)
plus processor configs that were serialized by a newer transformers/tokenizers
release than this image pins (tokenizers 0.19.1, pinned transitively by
paddlex 3.0.0). Two concrete incompatibilities:

  1. processor_config.json bundles the image-processor settings under an
     "image_processor" key. transformers 4.44.x only reads a standalone
     preprocessor_config.json with those fields at the top level.
  2. tokenizer.json uses a ModelWrapper enum variant that tokenizers 0.19.x
     can't deserialize (added in 0.20).

Both are fully recoverable because the user fine-tuned from
microsoft/trocr-base-printed (per training config) — the processor side
(image normalization stats + Roberta tokenizer vocabulary) matches the base
exactly. We pull the base processor from HuggingFace at build time, save its
assets next to the fine-tuned weights, and the resulting directory loads
cleanly with the pinned library versions.

No-op when the trocr checkpoint directory is absent so local dev builds
without weights still succeed.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from transformers import TrOCRProcessor

# The base model the user fine-tuned from (see
# RenAIssanceExperimental/experimentation.ipynb).
BASE_MODEL_ID = "microsoft/trocr-base-printed"

TROCR_DIR = Path("/app/models/weights/trocr")

# Files that belong to the fine-tuned weights — we must not overwrite these
# with the base model's copies.
FINETUNED_ARTIFACTS = {
    "config.json",
    "generation_config.json",
    "model.safetensors",
    "pytorch_model.bin",
}


def main() -> None:
    if not TROCR_DIR.is_dir():
        print(f"[normalize_trocr] {TROCR_DIR} does not exist — skipping")
        return

    weights = TROCR_DIR / "model.safetensors"
    if not weights.is_file():
        print(f"[normalize_trocr] no model.safetensors in {TROCR_DIR} — skipping")
        return

    print(f"[normalize_trocr] pulling processor assets from {BASE_MODEL_ID}")
    processor = TrOCRProcessor.from_pretrained(BASE_MODEL_ID)

    # Save all processor assets (preprocessor_config.json + vocab.json +
    # merges.txt + tokenizer_config.json + special_tokens_map.json +
    # tokenizer.json) into a staging directory, then copy only the files we
    # don't already have — this prevents clobbering the fine-tuned weights.
    staging = TROCR_DIR / ".processor_staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    processor.save_pretrained(staging)

    copied: list[str] = []
    replaced: list[str] = []
    for src in staging.iterdir():
        if src.name in FINETUNED_ARTIFACTS:
            continue
        dst = TROCR_DIR / src.name
        if dst.exists():
            replaced.append(src.name)
        else:
            copied.append(src.name)
        shutil.copy2(src, dst)

    shutil.rmtree(staging)

    # The newer-format bundled processor_config.json confuses 4.44.x's loader
    # once preprocessor_config.json is in place ("multiple values for
    # image_processor"). Remove it — the dir is self-consistent without it.
    stale = TROCR_DIR / "processor_config.json"
    if stale.exists():
        stale.unlink()
        replaced.append("processor_config.json (removed)")

    if copied:
        print(f"[normalize_trocr] copied: {sorted(copied)}")
    if replaced:
        print(f"[normalize_trocr] replaced: {sorted(replaced)}")
    print("[normalize_trocr] done")


if __name__ == "__main__":
    main()
