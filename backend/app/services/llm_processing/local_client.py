"""
Local (offline) LLM client for OCR text post-processing.

Runs an open-weights instruction model in-process via HuggingFace
``transformers`` — no API key, no network. This is the production counterpart
of RenAIssanceExperimental/src/postprocess/local_llm.py and uses the same
default model and prompt contract.

Default: ``Qwen/Qwen2.5-3B-Instruct`` (open weights, no HF token required,
strong Spanish, ~6 GB fp16 so it shares the OCR GPU). The model is lazily
downloaded + cached on first use, mirroring the PaddleOCR weight pattern.

`local_es` (the future Spanish-finetuned checkpoint) stays a disabled
placeholder in the factory; this `local` provider is a working general model.
"""

from threading import Lock

from .prompt_templates import get_template

DEFAULT_LOCAL_MODEL = "Qwen/Qwen2.5-3B-Instruct"

# Concise system instruction (the app sends whole-page plain text, not the
# numbered-line list the notebook uses, so the per-template user prompt drives
# the exact behaviour and this just sets the persona).
_SYSTEM_PROMPT = (
    "You are an expert OCR post-processing assistant for historical Spanish "
    "documents. You correct OCR errors faithfully without translating, "
    "modernising, summarising or adding content."
)

# (tokenizer, model) cache keyed by model id; guarded so concurrent requests
# don't trigger two simultaneous multi-GB loads.
_CACHE: dict = {}
_LOAD_LOCK = Lock()


def _load(model_name: str):
    cached = _CACHE.get(model_name)
    if cached is not None:
        return cached

    with _LOAD_LOCK:
        cached = _CACHE.get(model_name)
        if cached is not None:
            return cached

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        from app.utils.torch_device import select_torch_device

        device = select_torch_device()
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        )
        model.to(device)
        model.eval()
        _CACHE[model_name] = (tokenizer, model, device)
        return _CACHE[model_name]


def post_process_text_local(
    text: str,
    model: str = DEFAULT_LOCAL_MODEL,
    template_name: str = "full_cleanup",
) -> str:
    """
    Post-process OCR text with a locally-run instruction model.

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
