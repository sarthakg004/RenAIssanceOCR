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

# Install Python dependencies in two steps to sidestep a hard conflict
# between torch and paddlepaddle-gpu over their nvidia-*-cu12 pins (torch
# pins one set of CUDA user-space libs, paddle pins another; pip's resolver
# cannot satisfy both simultaneously). Both wheels bundle their own CUDA
# libs internally, so the duplicate site-packages nvidia-* entries are not
# needed at runtime — installing paddle with --no-deps avoids the conflict.
#
# BuildKit cache mount keeps ~/.cache/pip warm across builds so rebuilds
# after a requirements.txt edit don't re-download multi-GB PyTorch/Paddle
# wheels. Enable with:  DOCKER_BUILDKIT=1 docker build ...  (default in
# modern Docker).
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install --no-deps \
        --extra-index-url https://www.paddlepaddle.org.cn/packages/stable/cu126/ \
        paddlepaddle-gpu==3.3.0

# Pre-download paddlex fonts into site-packages. At first paddleocr
# import, paddlex.utils.fonts tries to download PingFang-SC-Regular.ttf
# and simfang.ttf INTO its own install directory — which fails at
# runtime because the app runs as non-root `appuser` and /opt/venv is
# owned by root. Baking the fonts in at build time (as root) makes the
# import succeed without needing any writable mount or chown of the
# entire venv.
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && PX_FONTS_DIR=/opt/venv/lib/python3.11/site-packages/paddlex/utils/fonts \
    && PX_FONT_BASE=https://paddle-model-ecology.bj.bcebos.com/paddlex/PaddleX3.0/fonts \
    && wget -q -O "$PX_FONTS_DIR/PingFang-SC-Regular.ttf" "$PX_FONT_BASE/PingFang-SC-Regular.ttf" \
    && wget -q -O "$PX_FONTS_DIR/simfang.ttf"            "$PX_FONT_BASE/simfang.ttf" \
    && apt-get purge -y --auto-remove wget \
    && rm -rf /var/lib/apt/lists/*

# Slim the venv before copying it into the runtime stage: strip all
# __pycache__ dirs and *.pyc/*.pyo files. Python will regenerate them
# lazily on first import — worth it because the builder-time bytecode
# for torch + paddle + transformers alone is several hundred MB of
# dead weight in the shipped image. We intentionally keep pip and
# setuptools installed; paddlex introspects pkg_resources at runtime.
RUN find /opt/venv -type d -name '__pycache__' -prune -exec rm -rf {} + && \
    find /opt/venv -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete


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

# Create non-root user and the model-cache directory up front so that the
# subsequent COPY --chown writes into correct ownership in a single layer
# (avoids a recursive chown over /app afterwards).
#
# At runtime /paddle_models is shadowed by a named Docker volume so
# downloaded models persist across container restarts (lazy-loaded on
# first use). We used to pre-download PaddleOCR weights here, but the
# named volume mounted at /paddle_models shadows this path at runtime,
# so the baked-in models were discarded anyway — bloating the image by
# ~1.5 GB for nothing. Lazy first-run download is the correct pattern.
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --home /home/appuser appuser && \
    mkdir -p /home/appuser /paddle_models && \
    chown appuser:appgroup /home/appuser /paddle_models

############################
# App setup
############################
WORKDIR /app
COPY --chown=appuser:appgroup . .

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--no-access-log"]
