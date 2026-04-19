# ============================================
# RenAIssance OCR Backend
# Multi-stage GPU build
#
# Stage 1 — ubuntu:24.04  (+Python 3.11 deadsnakes)
#            Installs all Python deps into /opt/venv
#
# Stage 2 — nvidia/cuda:12.6.3-runtime-ubuntu24.04  (+Python 3.11 deadsnakes)
#            Copies /opt/venv; provides libcuda / CUDA runtime libs
#
# WHY the same base OS for both stages:
#   Native extensions (.so wheels) are linked against the host distro's
#   glibc, OpenSSL and libstdc++.  Copying a venv from Debian 12 into
#   Ubuntu 24.04 (or vice-versa) causes "GLIBC_2.38 not found" /
#   "OPENSSL_3.3.0 not found" errors.  Using ubuntu:24.04 in the builder
#   guarantees the same ABI as the CUDA runtime image.
#
# GPU requirements on the host:
#   - NVIDIA driver >= 560 (supports CUDA 12.6)
#   - NVIDIA Container Toolkit installed
#   - Run:  docker run --gpus all -p 8000:8000 <image>
# ============================================

############################
# Stage 1 — dependency builder
############################
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install Python 3.11 from deadsnakes PPA + build tools.
# Ubuntu 24.04 ships Python 3.12 by default; using 3.11 here to match
# paddlepaddle-gpu ABI and keep numpy/other pinned versions stable.
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        ca-certificates \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get install -y --no-install-recommends \
        python3.11 \
        python3.11-dev \
        python3.11-venv \
        python3-pip \
        build-essential \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create a Python 3.11 virtual environment — all packages go here.
RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build
COPY requirements.txt .

# Install all Python dependencies into the venv.
# --extra-index-url adds the PaddlePaddle cu126 index so pip can find
# paddlepaddle-gpu (not published on PyPI).
# BuildKit cache mount keeps ~/.cache/pip warm across builds so rebuilds after
# a requirements.txt edit don't re-download multi-GB PyTorch/Paddle wheels.
# Enable with:  DOCKER_BUILDKIT=1 docker build ...  (default in modern Docker).
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
        --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cu126/ \
        -r requirements.txt


############################
# Stage 2 — CUDA runtime
############################
FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    HOME=/home/appuser \
    # venv from builder; takes precedence over any system Python
    PATH="/opt/venv/bin:$PATH" \
    # PaddleX / PaddleOCR model cache — mapped to a named Docker volume
    PADDLE_PDX_MODEL_CACHE_HOME=/paddle_models \
    # Disable experimental Paddle PIR to avoid ConvertPirAttribute errors
    FLAGS_enable_pir_api=0 \
    FLAGS_enable_pir_in_executor=0

# Install ONLY the Python 3.11 runtime (no -dev, no pip) plus the shared
# libraries that native extensions need at runtime.
# IMPORTANT: same deadsnakes PPA + same Python 3.11 as the builder so every
# .so in /opt/venv resolves its symbols correctly. One combined RUN keeps the
# apt cache clean-up in the same layer as the install.
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        ca-certificates \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get install -y --no-install-recommends \
        python3.11 \
        python3.11-venv \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && apt-get purge -y --auto-remove software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Copy the fully-built venv from the builder.
# Both stages are Ubuntu 24.04, so glibc / OpenSSL / libstdc++ are identical
# — no ABI mismatch possible.
COPY --from=builder /opt/venv /opt/venv

# Create the model-cache directory.
# At runtime this is shadowed by a named Docker volume so downloaded models
# persist across container restarts (lazy-loaded on first use).
#
# NOTE: we used to pre-download PaddleOCR weights here, but the named volume
# mounted at /paddle_models shadows this path at runtime, so the baked-in
# models were discarded anyway — bloating the image by ~1.5 GB for nothing.
# Lazy first-run download is the correct pattern; the named volume preserves
# weights across restarts.
RUN mkdir -p /paddle_models

############################
# App setup
############################
WORKDIR /app
COPY . .

# Non-root user for security.
# Give ownership of /paddle_models so the venv user can write model files
# when the named Docker volume is mounted at runtime.
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --home /home/appuser appuser && \
    mkdir -p /home/appuser && \
    chown -R appuser:appgroup /app /home/appuser /paddle_models

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--no-access-log"]
