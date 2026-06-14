"""Torch device selection: CUDA (NVIDIA) > MPS (Apple Metal) > CPU.

Centralizes the device pick so every torch-based model (TrOCR, CRNN, and the
local LLM post-processing) honors the same priority. The MPS branch lets the
torch parts use the Apple GPU when the backend runs *natively* on macOS — note
that Docker on macOS has no Metal passthrough, so containers always fall back to
CPU. PaddleOCR has no Metal backend and is unaffected by this helper.
"""

from __future__ import annotations

import torch


def select_torch_device() -> str:
    """Return the best available torch device string: "cuda", "mps", or "cpu"."""
    if torch.cuda.is_available():
        return "cuda"
    # getattr guards torch builds compiled without the mps backend attribute.
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def empty_device_cache(device: str) -> None:
    """Free cached allocator memory for the active accelerator (no-op on CPU)."""
    if device == "cuda":
        torch.cuda.empty_cache()
    elif device == "mps":
        mps = getattr(torch, "mps", None)
        if mps is not None and hasattr(mps, "empty_cache"):
            mps.empty_cache()
