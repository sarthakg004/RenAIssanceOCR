"""QLoRA fine-tuning of an open LLM into a line-level Spanish OCR corrector.

Training pairs are (raw OCR line, ground truth) from two engines: the stock
PaddleOCR latin recognizer (noisy) and our first CRNN (mostly clean). Together
they teach the model to fix real OCR errors and to leave correct lines alone.

Hardware: Qwen3-4B fits an 8 GB GPU; Gemma-3-4B was trained on Kaggle 2x T4,
where device_map="auto" shards the model across both cards.
"""

import pandas as pd
import torch
from sklearn.model_selection import GroupShuffleSplit

from .corpus import SEED
from .paths import DATA
from . import paths  # noqa: F401  (puts backend/ on sys.path)
from app.services.llm_processing.local_client import _FINETUNED_SYSTEM_PROMPT as SYSTEM_PROMPT

PAIRS = DATA / "postprocess_pairs"


def load_pairs() -> pd.DataFrame:
    """7,614 OCR/ground-truth line pairs: 3,807 per engine, with their book."""
    frames = [pd.read_csv(PAIRS / f"postprocess_pairs{suffix}.csv", keep_default_na=False).assign(source=source)
              for suffix, source in (("", "paddle"), ("_crnn", "crnn"))]
    return pd.concat(frames, ignore_index=True)


def split_pairs(pairs: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """The same book-level split as the recognizers: the 3 validation books never train the corrector."""
    train, val = next(GroupShuffleSplit(n_splits=1, test_size=0.1, random_state=SEED)
                      .split(pairs, groups=pairs["doc_id"]))
    return pairs.iloc[train], pairs.iloc[val]


def chat_example(ocr: str, truth: str) -> dict:
    return {"messages": [{"role": "system", "content": SYSTEM_PROMPT},
                         {"role": "user", "content": ocr},
                         {"role": "assistant", "content": truth}]}


class QLoRAFineTuner:
    """4-bit NF4 base model + rank-16 LoRA on every attention and MLP projection."""

    def __init__(self, model_id: str, out_dir, lr: float = 2e-4, epochs: int = 3,
                 batch_size: int = 4, grad_accum: int = 4):
        self.model_id, self.out_dir = model_id, str(out_dir)
        self.lr, self.epochs, self.batch_size, self.grad_accum = lr, epochs, batch_size, grad_accum
        # T4/P100 have no bfloat16; fall back to fp16 there.
        self.bf16 = torch.cuda.is_bf16_supported()

    def train(self, train: pd.DataFrame, val: pd.DataFrame) -> list[dict]:
        """Fine-tune with early stopping on validation loss; returns the training log."""
        from datasets import Dataset
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, EarlyStoppingCallback
        from trl import SFTConfig, SFTTrainer

        dtype = torch.bfloat16 if self.bf16 else torch.float16
        model = AutoModelForCausalLM.from_pretrained(
            self.model_id, device_map="auto", dtype=dtype,
            quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                                   bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype))
        model.config.use_cache = False  # incompatible with gradient checkpointing
        # Early stopping looks at a fixed 512-line sample, 256 per engine, so each eval takes ~1 min.
        val = val.groupby("source", group_keys=False).sample(n=256, random_state=SEED)
        to_ds = lambda df: Dataset.from_list([chat_example(o, g) for o, g in zip(df["ocr"], df["gt"])])

        trainer = SFTTrainer(
            model=model,
            processing_class=AutoTokenizer.from_pretrained(self.model_id),
            train_dataset=to_ds(train), eval_dataset=to_ds(val),
            peft_config=LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
                                   target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                                                   "gate_proj", "up_proj", "down_proj"]),
            args=SFTConfig(
                output_dir=self.out_dir, num_train_epochs=self.epochs, learning_rate=self.lr,
                per_device_train_batch_size=self.batch_size, gradient_accumulation_steps=self.grad_accum,
                lr_scheduler_type="cosine", warmup_ratio=0.03, logging_steps=20,
                eval_strategy="steps", eval_steps=100, per_device_eval_batch_size=8,
                save_strategy="steps", save_steps=100, save_total_limit=2,
                load_best_model_at_end=True, metric_for_best_model="eval_loss", greater_is_better=False,
                # The default "chunked_nll" loss breaks when accelerate shards the model across GPUs.
                loss_type="nll", bf16=self.bf16, fp16=not self.bf16,
                gradient_checkpointing=True, max_length=512, report_to="none"),
            callbacks=[EarlyStoppingCallback(early_stopping_patience=3)],
        )
        trainer.train()
        trainer.save_model(self.out_dir)
        return trainer.state.log_history
