"""Training the CRNN (CNN + BiLSTM + CTC) line recognizer.

The architecture is imported from the app, so the model trained here is exactly
the one the backend serves, and the saved checkpoint loads there unchanged.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm

from . import paths  # noqa: F401  (puts backend/ on sys.path)
from app.services.recognition.crnn_inference import CRNN, resize_keep_ratio
from .metrics import cer, wer

IMG_HEIGHT = 64
DOWNSAMPLE = 4   # the CNN halves the width twice: one output column per 4 px
PAD_VALUE = 1.0  # batch padding must look like blank paper, not ink


class Charset:
    """The characters the CRNN can output. Class 0 is the CTC blank."""

    def __init__(self, chars):
        self.chars = sorted(set(chars))
        self.index = {c: i + 1 for i, c in enumerate(self.chars)}

    @classmethod
    def from_texts(cls, texts) -> "Charset":
        return cls("".join(texts))

    @property
    def num_classes(self) -> int:
        return len(self.chars) + 1

    def encode(self, text: str) -> list[int]:
        # A character never seen in training can't be a target; it still counts in CER.
        return [self.index[c] for c in text if c in self.index]

    def decode(self, log_probs: torch.Tensor, lengths: torch.Tensor) -> list[str]:
        """Greedy CTC: best class per column, merge repeats, drop blanks."""
        texts = []
        for best, n in zip(log_probs.argmax(-1).cpu().numpy(), lengths.tolist()):
            prev, out = 0, []
            for k in best[:n]:
                if k != 0 and k != prev:
                    out.append(self.chars[k - 1])
                prev = k
            texts.append("".join(out))
        return texts


def fits_ctc(image_path: str, text: str) -> bool:
    """CTC needs one output column per character, plus a blank between repeated ones.

    A line that fails this is almost always a bad crop (a whole block of text
    with a one-line label) and would only ever give an infinite loss.
    """
    with Image.open(image_path) as im:
        w, h = im.size
    columns = max(1, int(w * IMG_HEIGHT / h)) // DOWNSAMPLE
    repeats = sum(a == b for a, b in zip(text, text[1:]))
    return columns >= len(text) + repeats


class LineDataset(Dataset):
    """Grayscale line images at height 64 (aspect ratio kept) with CTC targets."""

    AUGMENT = T.Compose([
        T.RandomApply([T.ColorJitter(brightness=0.35, contrast=0.35)], p=0.5),
        T.RandomApply([T.GaussianBlur(kernel_size=3, sigma=(0.1, 1.2))], p=0.25),
        T.RandomApply([T.RandomAffine(degrees=1.5, translate=(0.01, 0.03), scale=(0.93, 1.07),
                                      shear=1.5, fill=255)], p=0.5),
        T.RandomApply([T.RandomPerspective(distortion_scale=0.05, p=1.0, fill=255)], p=0.2),
    ])

    def __init__(self, lines: pd.DataFrame, charset: Charset, augment: bool = False):
        self.images, self.texts = list(lines["image"]), list(lines["text"])
        self.charset, self.augment = charset, augment
        self.to_tensor = T.ToTensor()

    def __len__(self) -> int:
        return len(self.texts)

    def __getitem__(self, i):
        img = resize_keep_ratio(Image.open(self.images[i]).convert("L"), IMG_HEIGHT)
        if self.augment:
            img = self.AUGMENT(img)
        target = torch.tensor(self.charset.encode(self.texts[i]), dtype=torch.long)
        return self.to_tensor(img), target, self.texts[i]

    @staticmethod
    def collate(batch):
        """Pad to the widest line with white; keep each line's true width for CTC."""
        images, targets, texts = zip(*batch)
        widths = torch.tensor([im.shape[-1] for im in images])
        images = torch.stack([nn.functional.pad(im, (0, int(widths.max()) - im.shape[-1]), value=PAD_VALUE)
                              for im in images])
        return images, torch.cat(targets), torch.tensor([len(t) for t in targets]), list(texts), widths


class CRNNTrainer:
    """AdamW + one-cycle schedule, mixed precision, early stopping on validation loss."""

    def __init__(self, charset: Charset, lstm_hidden: int = 256, lstm_layers: int = 3,
                 dropout: float = 0.3, lr: float = 3e-4, weight_decay: float = 1e-4,
                 batch_size: int = 16, device: str = "cuda"):
        self.charset, self.device, self.batch_size, self.lr = charset, device, batch_size, lr
        self.arch = dict(lstm_hidden=lstm_hidden, lstm_layers=lstm_layers)
        self.model = CRNN(charset.num_classes, lstm_hidden, lstm_layers, dropout).to(device)
        self.optimizer = torch.optim.AdamW(self.model.parameters(), lr=lr, weight_decay=weight_decay)
        self.loss_fn = nn.CTCLoss(blank=0, zero_infinity=True)
        self.scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda")

    def fit(self, train: LineDataset, val: LineDataset, out_dir: Path,
            epochs: int = 150, patience: int = 20) -> dict:
        """Train until validation loss stops improving; the best epoch is saved to out_dir."""
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        loaders = {name: DataLoader(ds, self.batch_size, shuffle=name == "train", num_workers=4,
                                    collate_fn=LineDataset.collate, pin_memory=True)
                   for name, ds in (("train", train), ("val", val))}
        self.scheduler = torch.optim.lr_scheduler.OneCycleLR(
            self.optimizer, max_lr=self.lr, epochs=epochs, steps_per_epoch=len(loaders["train"]),
            pct_start=0.05, div_factor=25, final_div_factor=1e4)

        history, best, waited = {k: [] for k in ("train_loss", "val_loss", "train_cer", "val_cer",
                                                 "train_wer", "val_wer")}, float("inf"), 0
        bar = tqdm(range(1, epochs + 1), desc="CRNN", unit="epoch")
        for epoch in bar:
            for split in ("train", "val"):
                loss, c, w = self._run_epoch(loaders[split], train=split == "train")
                history[f"{split}_loss"].append(loss)
                history[f"{split}_cer"].append(c)
                history[f"{split}_wer"].append(w)
            bar.set_postfix(val_loss=f"{history['val_loss'][-1]:.3f}", val_cer=f"{history['val_cer'][-1]:.3%}")
            if history["val_loss"][-1] < best:
                best, waited = history["val_loss"][-1], 0
                self.save(out_dir / "best_crnn.pth", epoch, history)
            else:
                waited += 1
            (out_dir / "history.json").write_text(json.dumps(history))
            if waited >= patience:
                break
        return history

    def _run_epoch(self, loader: DataLoader, train: bool):
        self.model.train(train)
        total, predictions, references = 0.0, [], []
        for images, targets, target_lengths, texts, widths in loader:
            images = images.to(self.device, non_blocking=True)
            with torch.set_grad_enabled(train), torch.autocast(self.device, enabled=self.device == "cuda"):
                log_probs = self.model(images)                                 # (B, T, classes)
                lengths = (widths // DOWNSAMPLE).clamp(max=log_probs.size(1))  # ignore padded columns
                loss = self.loss_fn(log_probs.permute(1, 0, 2).float(), targets, lengths, target_lengths)
            if train:
                self.optimizer.zero_grad(set_to_none=True)
                self.scaler.scale(loss).backward()
                self.scaler.unscale_(self.optimizer)
                nn.utils.clip_grad_norm_(self.model.parameters(), 5.0)
                self.scaler.step(self.optimizer)
                self.scaler.update()
                self.scheduler.step()
            total += loss.item()
            predictions += self.charset.decode(log_probs.detach().float(), lengths)
            references += texts
        return total / len(loader), cer(predictions, references), wer(predictions, references)

    def save(self, path: Path, epoch: int, history: dict) -> None:
        """Checkpoint in the format backend/app/services/recognition/crnn_inference.py loads."""
        torch.save({
            "model_state_dict": self.model.state_dict(),
            "vocab": self.charset.chars,
            "char2idx": {"<blank>": 0, **self.charset.index},
            "idx2char": {0: "<blank>", **{i: c for c, i in self.charset.index.items()}},
            "img_height": IMG_HEIGHT, "pad_value": PAD_VALUE, "epoch": epoch,
            "val_cer": history["val_cer"][-1], "val_wer": history["val_wer"][-1], **self.arch,
        }, path)


def set_seed(seed: int = 42) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)
