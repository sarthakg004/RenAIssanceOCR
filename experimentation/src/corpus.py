"""The line-level training corpus and its book-level train/validation split."""

from pathlib import Path

import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

REPO_ID = "Sarthak004/renaissanceocr-spanish-printed"
SEED = 42


def normalize(text: str) -> str:
    """Collapse every whitespace run (tabs, newlines, double spaces) to one space."""
    return " ".join(text.split())


class LineCorpus:
    """3,807 printed line images with transcriptions, from 26 early-modern Spanish books.

    `lines` has one row per line: image path, text, book and font type.
    """

    def __init__(self, root: str | None = None):
        self.root = Path(root or self._download())
        meta = pd.read_csv(self.root / "metadata.csv")
        self.lines = pd.DataFrame({
            "image": [str(self.root / p) for p in meta["image_path"]],
            "text": [normalize((self.root / p).read_text(encoding="utf-8-sig")) for p in meta["label_path"]],
            "book": meta["doc_id"],
            "font": meta["font_type"],
        })

    @staticmethod
    def _download() -> str:
        """The HuggingFace dataset snapshot: from the local cache when present."""
        from huggingface_hub import snapshot_download

        try:
            return snapshot_download(REPO_ID, repo_type="dataset", local_files_only=True)
        except Exception:  # not cached on this machine yet
            return snapshot_download(REPO_ID, repo_type="dataset")

    def split(self, val_fraction: float = 0.1) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Hold out whole books, so validation measures typefaces and paper the model never saw.

        Every experiment uses this split (seed 42): 23 books train, 3 books validate.
        """
        splitter = GroupShuffleSplit(n_splits=1, test_size=val_fraction, random_state=SEED)
        train, val = next(splitter.split(self.lines, groups=self.lines["book"]))
        return self.lines.iloc[train].reset_index(drop=True), self.lines.iloc[val].reset_index(drop=True)
