"""Train a line recognizer on the shared book-level split.

    python experimentation/scripts/train.py crnn     # ~1.5 h on an RTX 4060
    python experimentation/scripts/train.py trocr    # ~50 min (6 epochs)

Checkpoints and history.json go to experimentation/checkpoints/<model>/.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.corpus import LineCorpus  # noqa: E402
from src.paths import CHECKPOINTS  # noqa: E402


def train_crnn():
    from src.crnn import Charset, CRNNTrainer, LineDataset, fits_ctc, set_seed

    set_seed()
    train, val = LineCorpus().split()
    keep = [fits_ctc(i, t) for i, t in zip(train["image"], train["text"])]
    print(f"dropping {keep.count(False)} training line(s) CTC cannot fit:",
          list(train.loc[[not k for k in keep], "image"].map(lambda p: Path(p).name)))
    train = train[keep].reset_index(drop=True)
    charset = Charset.from_texts(train["text"])
    print(f"train {len(train)} lines | val {len(val)} lines | {len(charset.chars)} characters + blank")
    trainer = CRNNTrainer(charset)
    trainer.fit(LineDataset(train, charset, augment=True), LineDataset(val, charset), CHECKPOINTS / "crnn")


def train_trocr():
    from src.trocr import TrOCRTrainer

    train, val = LineCorpus().split()
    TrOCRTrainer().fit(train, val, CHECKPOINTS / "trocr", epochs=6)


if __name__ == "__main__":
    {"crnn": train_crnn, "trocr": train_trocr}[sys.argv[1]]()
