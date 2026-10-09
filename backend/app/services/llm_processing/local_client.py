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


def base_model_cached() -> bool:
    """True when the gated base weights are already on disk.

    Mirrors layout_detection.models_cached: the UI probes this so it can warn
    about the one-time ~8 GB download instead of looking hung. Filesystem only
    — never imports torch/transformers, so it stays cheap to call.

    huggingface_hub only creates a snapshot symlink once a blob has finished
    downloading, so a half-done shard leaves a dangling/absent entry and
    .exists() correctly reports False.
    """
    hf_home = os.environ.get("HF_HOME") or str(Path.home() / ".cache" / "huggingface")
    repo = (
        Path(hf_home) / "hub"
        / ("models--" + FINETUNED_BASE_MODEL.replace("/", "--"))
    )
    snapshots = repo / "snapshots"
    if not snapshots.is_dir():
        return False

    for snap in snapshots.iterdir():
        # Sharded checkpoints (gemma-3-4b is 2 shards): every file named in the
        # index must be present, or we would flash "ready" mid-download.
        index = snap / "model.safetensors.index.json"
        if index.is_file():
            try:
                import json

                shards = set(json.loads(index.read_text())["weight_map"].values())
            except (OSError, ValueError, KeyError):
                continue
            if shards and all((snap / s).exists() for s in shards):
                return True
        elif (snap / "model.safetensors").exists():
            return True
    return False


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

        # NEVER fp16 here. gemma-3 is bf16-trained and its activations overflow
        # fp16: the logits go NaN, generate() emits nothing but <pad>, and the
        # caller below keeps every original line — a silent no-op that looks
        # like "the model had no corrections to make" rather than a failure.
        # bf16 needs Ampere or newer, so older cards take the fp32 path (slower,
        # but correct).
        if device == "cuda":
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
        else:
            dtype = torch.float32

        load_kwargs: dict = {}
        if quantize and device == "cuda":
            from transformers import BitsAndBytesConfig

            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=dtype,
            )
            load_kwargs["device_map"] = "auto"
        # torch_dtype, not dtype — the image pins transformers 4.53. Still a
        # valid alias in 5.x, so this works both places.
        load_kwargs["torch_dtype"] = dtype

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


class LocalCorrector:
    """A base causal LM plus a LoRA adapter, correcting OCR one line at a time.

    Line by line because that is how the adapters were trained; a whole page is
    out of distribution. 4-bit on CUDA only. The app uses the default (gemma +
    our Spanish adapter); the experiments also evaluate a Qwen3 adapter.
    """

    def __init__(self, base_model: str = FINETUNED_BASE_MODEL, adapter_dir: str | None = None,
                 batch_size: int = 16):
        self.base_model, self.batch_size = base_model, batch_size
        self.adapter_dir = adapter_dir or _adapter_dir()

    def correct(self, text: str) -> str:
        """Correct every non-blank line; blank lines and line count are preserved."""
        if not text or not text.strip():
            return text
        lines = text.split("\n")
        out, answered = self.correct_lines(lines)
        # Keeping a line the model left empty is right per line, but answering
        # nothing at all means it is broken (fp16 NaN logits do exactly this) and
        # echoing the input back would look like a clean run. Fail loudly.
        if answered == 0 and any(l.strip() for l in lines):
            raise ValueError("Fine-tuned model returned no output for any line — "
                             "it may have failed to load correctly.")
        result = "\n".join(out).strip()
        if not result:
            raise ValueError("Fine-tuned model returned an empty response")
        return result

    def correct_lines(self, lines: list[str]) -> tuple[list[str], int]:
        """-> (corrected lines in input order, how many the model answered)."""
        import torch

        idx = [i for i, ln in enumerate(lines) if ln.strip()]
        if not idx:  # nothing to correct (e.g. a page where detection found no text)
            return list(lines), 0

        tokenizer, llm, device = self._load()
        tokenizer.padding_side = "left"  # decoder-only batched generation
        stop_ids = llm.generation_config.eos_token_id
        stop_ids = set(stop_ids) if isinstance(stop_ids, (list, tuple)) else {stop_ids}

        # Batch lines of similar length: a batch runs as many steps as its
        # longest row, so mixing a 5-token line with a 60-token one makes the
        # short ones pay. Results go back by original index.
        lengths = dict(zip(idx, (len(t) for t in tokenizer([lines[i] for i in idx],
                                                              add_special_tokens=False).input_ids)))
        idx.sort(key=lengths.__getitem__)
        out, answered = list(lines), 0
        for start in range(0, len(idx), self.batch_size):
            chunk = idx[start:start + self.batch_size]
            prompts = [tokenizer.apply_chat_template(
                [{"role": "system", "content": _FINETUNED_SYSTEM_PROMPT},
                 {"role": "user", "content": lines[i]}],
                tokenize=False, add_generation_prompt=True) for i in chunk]
            enc = tokenizer(prompts, return_tensors="pt", padding=True).to(device)
            # A corrected line is about as long as its input (glyph repair, not
            # translation). ponytail: 1.5x + 16 is generous, not tuned; the stop-
            # token guard below catches any overrun, so a tight cap only costs a
            # correction, never truncates a line.
            cap = min(160, int(max(lengths[i] for i in chunk) * 1.5) + 16)
            with torch.no_grad():
                gen = llm.generate(**enc, max_new_tokens=cap, do_sample=False,
                                   pad_token_id=tokenizer.pad_token_id)
            new = gen[:, enc["input_ids"].shape[1]:]
            for i, corrected, row in zip(chunk, tokenizer.batch_decode(new, skip_special_tokens=True), new):
                # No stop token = cut off at the cap: keep the original, not half a line.
                if stop_ids.isdisjoint(row.tolist()):
                    continue
                # One line in, one line out: the frontend maps results onto boxes by index.
                corrected = " ".join(corrected.split())
                if corrected:
                    out[i] = corrected
                    answered += 1
        return out, answered

    def _load(self):
        from app.utils.torch_device import select_torch_device

        if select_torch_device() != "cuda":
            raise ValueError("The local fine-tuned Spanish model requires a GPU (4-bit QLoRA). "
                             "Use a cloud provider (Gemini/OpenAI) on CPU-only hosts.")
        if not os.path.isdir(self.adapter_dir):
            raise ValueError(f"Fine-tuned adapter not found at {self.adapter_dir}")
        try:
            return _load(self.base_model, adapter_dir=self.adapter_dir, quantize=True)
        except Exception as exc:
            # Turn huggingface_hub's GatedRepoError/401 into something actionable.
            msg = str(exc).lower()
            if any(k in msg for k in ("gated", "401", "authoriz", "token")):
                raise ValueError(
                    f"Could not download the gated base model '{self.base_model}'. Set HF_TOKEN "
                    f"in the environment and accept the licence at huggingface.co/{self.base_model}."
                ) from exc
            raise


def post_process_text_finetuned(text: str, model: str | None = None,
                                template_name: str | None = None, batch_size: int = 16) -> str:
    """The `local_es` provider. model/template are ignored: the adapter and its prompt are fixed."""
    return LocalCorrector(batch_size=batch_size).correct(text)
