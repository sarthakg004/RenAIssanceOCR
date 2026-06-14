"""The shared torch device helper must pick a valid device and never crash on
its cache-clearing path (covers the new cuda/mps/cpu selection)."""

from app.utils.torch_device import empty_device_cache, select_torch_device


def test_select_returns_known_device():
    assert select_torch_device() in ("cuda", "mps", "cpu")


def test_empty_cache_is_noop_on_cpu():
    # Must not raise regardless of the active backend.
    empty_device_cache("cpu")


def test_cuda_preferred_when_available(monkeypatch):
    import app.utils.torch_device as td

    monkeypatch.setattr(td.torch.cuda, "is_available", lambda: True)
    assert td.select_torch_device() == "cuda"


def test_mps_used_when_no_cuda(monkeypatch):
    import app.utils.torch_device as td

    monkeypatch.setattr(td.torch.cuda, "is_available", lambda: False)

    class _FakeMps:
        @staticmethod
        def is_available():
            return True

    monkeypatch.setattr(td.torch.backends, "mps", _FakeMps, raising=False)
    assert td.select_torch_device() == "mps"
