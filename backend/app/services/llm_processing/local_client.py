"""
Local (offline) LLM clients for OCR text post-processing.

Two flavours, both run in-process via HuggingFace ``transformers`` — no API
key, no network at inference time:

* ``local``    — a general open-weights instruction model (default
                 ``Qwen/Qwen2.5-3B-Instruct``), whole-page cleanup driven by
                 the prompt templates. Base weights downloaded + cached on
                 first use (mirrors the PaddleOCR weight pattern).
* ``local_es`` — our Spanish-finetuned corrector: base
                 ``Qwen/Qwen3-4B-Instruct-2507`` + a LoRA adapter shipped in
                 the image (models/weights/postprocess/...). Loaded in 4-bit
                 (QLoRA, the same config it was trained with) and run
                 **per line**, exactly as in
                 RenAIssanceExperimental notebook 05. Requires CUDA — 4-bit
                 needs a GPU, and it keeps the footprint to ~3 GB VRAM.
"""

import os
from pathlib import Path
from threading import Lock

from .prompt_templates import get_template

DEFAULT_LOCAL_MODEL = "Qwen/Qwen2.5-3B-Instruct"

# The Spanish-finetuned corrector: base model + shipped LoRA adapter.
FINETUNED_BASE_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
FINETUNED_ADAPTER_SUBDIR = "postprocess/Qwen3-4B-Instruct-2507-lora"

# Per-line palaeography system prompt — MUST match the one the adapter was
# fine-tuned with (RenAIssanceExperimental notebook 05). The model expects one
# raw OCR line per turn and returns the corrected line.
_FINETUNED_SYSTEM_PROMPT = (
    "You are an expert in early-modern Spanish (15th-19th century) palaeography "
    "and OCR correction. The user gives you one raw OCR line from a historical "
    "Spanish document. Return ONLY the corrected line, nothing else. "
    "Fix glyph confusions (rn→m, 0→o, 1/I→l, ſ→s), restore diacritics "
    "(á é í ó ú ñ ç), and merge or split wrongly tokenised words. "
    "Preserve the original early-modern spelling: never modernise, translate, "
    "or add content. If the line is already correct, return it unchanged."
)

# Concise system instruction for the general `local` model (whole-page input,
# the per-template user prompt drives the exact behaviour).
_SYSTEM_PROMPT = (
    "You are an expert OCR post-processing assistant for historical Spanish "
    "documents. You correct OCR errors faithfully without translating, "
    "modernising, summarising or adding content."
)

# (tokenizer, model, device) cache keyed by a load key; guarded so concurrent
# requests don't trigger two simultaneous multi-GB loads.
_CACHE: dict = {}
_LOAD_LOCK = Lock()


def _adapter_dir() -> str:
    """Resolve the shipped LoRA adapter directory (dev + container layouts)."""
    # this file: backend/app/services/llm_processing/local_client.py
    backend_root = Path(__file__).resolve().parents[3]
    return str(backend_root / "models" / "weights" / FINETUNED_ADAPTER_SUBDIR)


def _load(model_name: str, *, adapter_dir: str | None = None, quantize: bool = False):
    """
    Load (and cache) a tokenizer + causal-LM.

    adapter_dir: if given, load `model_name` as base then apply the PEFT LoRA
                 adapter from this local directory.
    quantize:    if True and CUDA is available, load the base in 4-bit nf4
                 (QLoRA) — keeps the finetuned 4B model at ~3 GB VRAM.
    """
    key = f"{model_name}::{adapter_dir or ''}::{'q4' if quantize else 'full'}"
    cached = _CACHE.get(key)
    if cached is not None:
        return cached

    with _LOAD_LOCK:
        cached = _CACHE.get(key)
        if cached is not None:
            return cached

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        from app.utils.torch_device import select_torch_device

        device = select_torch_device()

        # Always load the tokenizer from the BASE model, never the adapter dir:
        # a LoRA adapter doesn't change the vocabulary, and the base model's
        # tokenizer.json is always format-compatible with the installed
        # tokenizers version (the shipped adapter file was serialized by a
        # newer tokenizers and might not deserialize under the pinned one).
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        load_kwargs: dict = {}
        if quantize and device == "cuda":
            from transformers import BitsAndBytesConfig

            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.float16,
            )
            load_kwargs["device_map"] = "auto"
            # `torch_dtype` (not `dtype`): the image pins transformers 4.53,
            # where `torch_dtype` is the accepted arg; it stays a valid alias
            # in transformers 5.x too, so this works in dev and in the image.
            load_kwargs["torch_dtype"] = torch.float16
        else:
            load_kwargs["torch_dtype"] = (
                torch.float16 if device == "cuda" else torch.float32
            )

        # OOM guard: keep only ONE local LLM resident, and free it BEFORE
        # loading the new one so a provider switch (e.g. the 6 GB fp16 `local`
        # → the 3 GB 4-bit `local_es`) never holds both on an 8 GB GPU at once.
        # Post-processing runs one request at a time, so this is safe.
        _evict_all_except(key)

        model = AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)

        if adapter_dir:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter_dir)

        # device_map="auto" already placed the (quantized) model; only move
        # non-quantized models explicitly.
        if "device_map" not in load_kwargs:
            model.to(device)
        model.eval()

        _CACHE[key] = (tokenizer, model, device)
        return _CACHE[key]


def _evict_all_except(keep_key: str) -> None:
    """Free every cached local LLM except `keep_key` (frees VRAM/RAM)."""
    import gc

    import torch

    for k in [k for k in _CACHE if k != keep_key]:
        _, model, device = _CACHE.pop(k)
        del model
        gc.collect()
        if device == "cuda":
            torch.cuda.empty_cache()


def post_process_text_local(
    text: str,
    model: str = DEFAULT_LOCAL_MODEL,
    template_name: str = "full_cleanup",
) -> str:
    """
    Post-process OCR text with a locally-run general instruction model.

    Same return contract as the API clients: takes plain text, returns the
    cleaned plain text (raises on failure / empty output).
    """
    if not text or not text.strip():
        return text

    import torch

    model_name = model or DEFAULT_LOCAL_MODEL
    tokenizer, llm, device = _load(model_name)

    prompt = get_template(template_name) + text
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    prompt_text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = tokenizer(prompt_text, return_tensors="pt").to(device)

    with torch.no_grad():
        generated = llm.generate(
            **inputs,
            max_new_tokens=4096,
            do_sample=False,
            pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
        )

    new_tokens = generated[0][inputs["input_ids"].shape[1]:]
    result = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

    if not result:
        raise ValueError("Local LLM returned an empty response")
    return result


def post_process_text_finetuned(
    text: str,
    model: str | None = None,          # ignored; adapter is fixed
    template_name: str | None = None,  # ignored; per-line system prompt is fixed
    batch_size: int = 16,
) -> str:
    """
    Correct OCR text with the Spanish-finetuned Qwen3-4B LoRA adapter.

    The model was trained on single OCR lines, so we correct **line by line**
    (blank lines preserved to keep the page structure) and rejoin — feeding it
    a whole page would be out of distribution. 4-bit QLoRA on the GPU.

    Requires CUDA: the 4-bit adapter needs a GPU. Raises a clear error on CPU
    (the API providers remain available there).
    """
    if not text or not text.strip():
        return text

    import torch

    from app.utils.torch_device import select_torch_device

    if select_torch_device() != "cuda":
        raise ValueError(
            "The local fine-tuned Spanish model requires a GPU (4-bit QLoRA). "
            "Use a cloud provider or the general 'Local LLM' on CPU-only hosts."
        )

    adapter_dir = _adapter_dir()
    if not os.path.isdir(adapter_dir):
        raise ValueError(f"Fine-tuned adapter not found at {adapter_dir}")

    tokenizer, llm, device = _load(
        FINETUNED_BASE_MODEL, adapter_dir=adapter_dir, quantize=True
    )
    tokenizer.padding_side = "left"  # decoder-only batched generation

    # Split into lines; correct only non-blank lines, preserve the rest so the
    # page structure (paragraph breaks) survives.
    lines = text.split("\n")
    idx = [i for i, ln in enumerate(lines) if ln.strip()]
    out = list(lines)

    for start in range(0, len(idx), batch_size):
        chunk_idx = idx[start:start + batch_size]
        prompts = [
            tokenizer.apply_chat_template(
                [
                    {"role": "system", "content": _FINETUNED_SYSTEM_PROMPT},
                    {"role": "user", "content": lines[i]},
                ],
                tokenize=False,
                add_generation_prompt=True,
            )
            for i in chunk_idx
        ]
        enc = tokenizer(prompts, return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            gen = llm.generate(
                **enc,
                max_new_tokens=160,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
            )
        new = gen[:, enc["input_ids"].shape[1]:]
        decoded = tokenizer.batch_decode(new, skip_special_tokens=True)
        for i, corrected in zip(chunk_idx, decoded):
            # Collapse any stray newlines: the frontend maps the result back
            # onto boxes by line index, so one input line must stay one output
            # line. Never blank out a line the model empties by mistake.
            corrected = " ".join(corrected.split()).strip()
            if corrected:
                out[i] = corrected

    result = "\n".join(out).strip()
    if not result:
        raise ValueError("Fine-tuned model returned an empty response")
    return result
