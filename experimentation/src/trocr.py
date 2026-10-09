"""Fine-tuning TrOCR (ViT encoder + Transformer decoder) on the line corpus.

Recipe changes from the first, unstable run:
- keep the pretrained decoder start token (2, "</s>") instead of overriding it to 0;
- drop the tokenizer's leading <s> from the labels, so the decoder input is
  [</s>, t1, ..., tn] and the targets are [t1, ..., tn, </s>], as in pretraining;
- learning rate 2e-5 (was 5e-5) with a short warm-up and cosine decay over
  6 epochs, effective batch 16 (was 4), bf16 instead of fp16.
"""

import json
import math
from pathlib import Path

import pandas as pd
import torch
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm
from transformers import TrOCRProcessor, VisionEncoderDecoderModel, get_cosine_schedule_with_warmup

from .metrics import cer, wer

BASE_MODEL = "microsoft/trocr-base-printed"
MAX_TOKENS = 128  # our longest line is 43 tokens


class TrOCRLineDataset(Dataset):
    """RGB line images resized to 384x384, with tokenized labels (padding = -100)."""

    def __init__(self, lines: pd.DataFrame, processor: TrOCRProcessor):
        self.images, self.texts, self.processor = list(lines["image"]), list(lines["text"]), processor

    def __len__(self) -> int:
        return len(self.texts)

    def __getitem__(self, i):
        pixels = self.processor(images=Image.open(self.images[i]).convert("RGB"),
                                return_tensors="pt").pixel_values[0]
        ids = self.processor.tokenizer(self.texts[i], truncation=True, max_length=MAX_TOKENS + 1).input_ids[1:]
        return pixels, torch.tensor(ids), self.texts[i]

    @staticmethod
    def collate(batch):
        pixels, ids, texts = zip(*batch)
        labels = torch.nn.utils.rnn.pad_sequence(ids, batch_first=True, padding_value=-100)
        return torch.stack(pixels), labels, list(texts)


class TrOCRTrainer:
    """AdamW, cosine schedule with warm-up, gradient accumulation, early stopping on validation CER."""

    def __init__(self, base: str = BASE_MODEL, lr: float = 2e-5, batch_size: int = 4,
                 grad_accum: int = 4, warmup: float = 0.05, device: str = "cuda"):
        # use_fast=False: the app's pinned transformers serves with the slow image processor.
        self.processor = TrOCRProcessor.from_pretrained(base, use_fast=False)
        self.model = VisionEncoderDecoderModel.from_pretrained(base).to(device)
        tok = self.processor.tokenizer
        self.model.config.pad_token_id = tok.pad_token_id
        self.model.config.eos_token_id = tok.eos_token_id
        self.model.config.decoder_start_token_id = self.model.generation_config.decoder_start_token_id
        self.model.encoder.gradient_checkpointing_enable()
        self.lr, self.batch_size, self.grad_accum, self.warmup, self.device = lr, batch_size, grad_accum, warmup, device

    def fit(self, train: pd.DataFrame, val: pd.DataFrame, out_dir: Path,
            epochs: int = 6, patience: int = 3) -> dict:
        """Fine-tune until validation CER stops improving; the best epoch is saved to out_dir."""
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        load = lambda df, shuffle: DataLoader(TrOCRLineDataset(df, self.processor), self.batch_size,
                                              shuffle=shuffle, num_workers=4,
                                              collate_fn=TrOCRLineDataset.collate, pin_memory=True)
        train_loader, val_loader = load(train, True), load(val, False)
        steps = epochs * math.ceil(len(train_loader) / self.grad_accum)
        optimizer = torch.optim.AdamW(self.model.parameters(), lr=self.lr, weight_decay=1e-4)
        scheduler = get_cosine_schedule_with_warmup(optimizer, int(self.warmup * steps), steps)

        history, best, waited = {k: [] for k in ("train_loss", "val_loss", "val_cer", "val_wer")}, 1.0, 0
        for epoch in range(1, epochs + 1):
            self.model.train()
            total = 0.0
            for i, (pixels, labels, _) in enumerate(tqdm(train_loader, desc=f"TrOCR epoch {epoch}", leave=False)):
                with torch.autocast(self.device, dtype=torch.bfloat16):
                    loss = self.model(pixel_values=pixels.to(self.device), labels=labels.to(self.device)).loss
                (loss / self.grad_accum).backward()
                total += loss.item()
                if (i + 1) % self.grad_accum == 0 or i + 1 == len(train_loader):
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                    optimizer.step()
                    scheduler.step()
                    optimizer.zero_grad(set_to_none=True)
            history["train_loss"].append(total / len(train_loader))
            for k, v in zip(("val_loss", "val_cer", "val_wer"), self.evaluate(val_loader)):
                history[k].append(v)
            print(f"epoch {epoch}: train_loss {history['train_loss'][-1]:.4f} | val_loss {history['val_loss'][-1]:.4f}"
                  f" | val CER {history['val_cer'][-1]:.2%} | val WER {history['val_wer'][-1]:.2%}", flush=True)
            if history["val_cer"][-1] < best:
                best, waited = history["val_cer"][-1], 0
                self.model.save_pretrained(out_dir)
                self.processor.save_pretrained(out_dir)
            else:
                waited += 1
            (out_dir / "history.json").write_text(json.dumps(history))
            if waited >= patience:
                break
        return history

    @torch.no_grad()
    def evaluate(self, loader: DataLoader) -> tuple[float, float, float]:
        """Teacher-forced loss plus greedy-decoding CER/WER."""
        self.model.eval()
        total, predictions, references = 0.0, [], []
        for pixels, labels, texts in loader:
            pixels = pixels.to(self.device)
            with torch.autocast(self.device, dtype=torch.bfloat16):
                total += self.model(pixel_values=pixels, labels=labels.to(self.device)).loss.item()
                ids = self.model.generate(pixels, max_new_tokens=MAX_TOKENS, num_beams=1)
            predictions += [t.strip() for t in self.processor.batch_decode(ids, skip_special_tokens=True)]
            references += texts
        return total / len(loader), cer(predictions, references), wer(predictions, references)


PRECISIONS = {  # name -> from_pretrained kwargs; the same checkpoint at different precisions
    "fp32": {},
    "fp16": {"dtype": torch.float16},
    "int8": {"load_in_8bit": True},
    "4-bit NF4": {"load_in_4bit": True, "bnb_4bit_quant_type": "nf4", "bnb_4bit_use_double_quant": True},
    "4-bit FP4": {"load_in_4bit": True, "bnb_4bit_quant_type": "fp4"},
}


@torch.no_grad()
def benchmark_precisions(model_dir, lines: pd.DataFrame, batch_size: int = 8) -> pd.DataFrame:
    """Post-training quantization (bitsandbytes): CER, WER, memory and speed per precision.

    bitsandbytes works on any HF model, including encoder-decoders like TrOCR,
    which calibration methods such as GPTQ/AWQ do not support.
    """
    import time
    from transformers import BitsAndBytesConfig

    processor = TrOCRProcessor.from_pretrained(model_dir, use_fast=False)
    loader = DataLoader(TrOCRLineDataset(lines, processor), batch_size, collate_fn=TrOCRLineDataset.collate)
    rows = []
    for name, kwargs in PRECISIONS.items():
        quant = {k: v for k, v in kwargs.items() if k.startswith(("load_in", "bnb_"))}
        if quant:
            kwargs = {"quantization_config": BitsAndBytesConfig(**quant, bnb_4bit_compute_dtype=torch.float16),
                      "device_map": {"": 0}}
        model = VisionEncoderDecoderModel.from_pretrained(model_dir, **kwargs).eval()
        if not quant:
            model = model.to("cuda")
        dtype = torch.float16 if name != "fp32" else torch.float32
        predictions, seconds = [], 0.0
        for i, (pixels, _, _) in enumerate(loader):
            pixels = pixels.to("cuda", dtype)
            if i == 0:
                model.generate(pixels[:1], max_new_tokens=8)  # warm-up, not timed
            torch.cuda.synchronize()
            start = time.perf_counter()
            ids = model.generate(pixels, max_new_tokens=MAX_TOKENS, num_beams=1)
            torch.cuda.synchronize()
            seconds += time.perf_counter() - start
            predictions += [t.strip() for t in processor.batch_decode(ids, skip_special_tokens=True)]
        rows.append({"precision": name, "cer": cer(predictions, list(lines["text"])),
                     "wer": wer(predictions, list(lines["text"])),
                     "size_mb": model.get_memory_footprint() / 2**20, "ms_per_line": 1000 * seconds / len(lines)})
        del model
        torch.cuda.empty_cache()
    return pd.DataFrame(rows).set_index("precision")
