"""The `local_es` corrector: gemma-3-4b-it + our shipped Spanish LoRA adapter.

Runs in 4-bit QLoRA (same config it was trained with, ~3.5 GB VRAM) and corrects
one line at a time, matching training. GPU only — 4-bit needs CUDA.

gemma-3 is gated on HuggingFace, so the first base-weights download needs
HF_TOKEN set and the licence accepted at huggingface.co/google/gemma-3-4b-it.
"""

import os
from pathlib import Path
from threading import Lock

# AutoModelForCausalLM resolves this to the multimodal Gemma3 class; text-only
# generation works fine and matches how the adapter was trained.
FINETUNED_BASE_MODEL = "google/gemma-3-4b-it"
FINETUNED_ADAPTER_SUBDIR = "postprocess/gemma-3-4b-it-lora"

# Must stay byte-identical to the prompt the adapter was fine-tuned with.
_FINETUNED_SYSTEM_PROMPT = (
    "You are an expert in early-modern Spanish (15th-19th century) palaeography "
    "and OCR correction. The user gives you one raw OCR line from a historical "
    "Spanish document. Return ONLY the corrected line, nothing else. "
    "Fix glyph confusions (rn→m, 0→o, 1/I→l, ſ→s), restore diacritics "
    "(á é í ó ú ñ ç), and merge or split wrongly tokenised words. "
    "Preserve the original early-modern spelling: never modernise, translate, "
    "or add content. If the line is already correct, return it unchanged."
)

# (tokenizer, model, device) cache. The lock stops two requests from kicking off
# simultaneous multi-GB loads.
_CACHE: dict = {}
_LOAD_LOCK = Lock()


def _adapter_dir() -> str:
    """Shipped LoRA adapter dir; same path in dev and in the container."""
    backend_root = Path(__file__).resolve().parents[3]
    return str(backend_root / "models" / "weights" / FINETUNED_ADAPTER_SUBDIR)


def _load(model_name: str, *, adapter_dir: str | None = None, quantize: bool = False):
    """Load and cache a tokenizer + causal LM.

    adapter_dir applies a local PEFT LoRA on top of the base; quantize loads
    4-bit nf4 when CUDA is present, which keeps the 4B model near 3 GB VRAM.
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

        # Tokenizer comes from the BASE model, never the adapter dir. LoRA
        # doesn't touch the vocabulary, and the adapter's tokenizer.json was
        # serialized by a newer `tokenizers` than the one pinned in the image.
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
            # torch_dtype, not dtype — the image pins transformers 4.53. Still a
            # valid alias in 5.x, so this works both places.
            load_kwargs["torch_dtype"] = torch.float16
        else:
            load_kwargs["torch_dtype"] = (
                torch.float16 if device == "cuda" else torch.float32
            )

        # One local LLM resident at a time, evicted BEFORE the new load —
        # otherwise switching providers holds both on an 8 GB GPU and OOMs.
        # Safe because post-processing runs one request at a time.
        _evict_all_except(key)

        model = AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)

        if adapter_dir:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter_dir)

        # device_map="auto" already placed the quantized model.
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


def post_process_text_finetuned(
    text: str,
    model: str | None = None,          # ignored; adapter is fixed
    template_name: str | None = None,  # ignored; per-line system prompt is fixed
    batch_size: int = 16,
) -> str:
    """Correct OCR text with the Spanish-finetuned gemma LoRA.

    Line by line, because that's how the adapter was trained — a whole page is
    out of distribution. Blank lines are kept so paragraphs survive. Raises on
    CPU-only hosts; the API providers still work there.
    """
    if not text or not text.strip():
        return text

    import torch

    from app.utils.torch_device import select_torch_device

    if select_torch_device() != "cuda":
        raise ValueError(
            "The local fine-tuned Spanish model requires a GPU (4-bit QLoRA). "
            "Use a cloud provider (Gemini/OpenAI) on CPU-only hosts."
        )

    adapter_dir = _adapter_dir()
    if not os.path.isdir(adapter_dir):
        raise ValueError(f"Fine-tuned adapter not found at {adapter_dir}")

    try:
        tokenizer, llm, device = _load(
            FINETUNED_BASE_MODEL, adapter_dir=adapter_dir, quantize=True
        )
    except Exception as exc:
        # Turn huggingface_hub's GatedRepoError/401 into something actionable.
        msg = str(exc).lower()
        if "gated" in msg or "401" in msg or "authoriz" in msg or "token" in msg:
            raise ValueError(
                f"Could not download the gated base model '{FINETUNED_BASE_MODEL}'. "
                "Set HF_TOKEN in the environment and accept the licence at "
                "huggingface.co/google/gemma-3-4b-it."
            ) from exc
        raise
    tokenizer.padding_side = "left"  # decoder-only batched generation

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
            # One input line must stay one output line — the frontend maps
            # results back onto boxes by index. Never blank a line out either.
            corrected = " ".join(corrected.split()).strip()
            if corrected:
                out[i] = corrected

    result = "\n".join(out).strip()
    if not result:
        raise ValueError("Fine-tuned model returned an empty response")
    return result
