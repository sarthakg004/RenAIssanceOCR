# RenAIssance — OCR Preprocessing Studio

A full-stack web app for preprocessing historical documents and extracting text
with multiple OCR backends. Upload a PDF or image, pick the pages you care
about, clean them up with a configurable OpenCV pipeline, detect text regions
with PaddleOCR, and transcribe with your choice of provider.

**Providers:** Gemini, ChatGPT, local CRNN, local TrOCR (fine-tuned from
`microsoft/trocr-base-printed`).

---

## What you need

- **Docker** ≥ 24 with Compose v2
- **~15 GB** free disk for images + model weights
- **NVIDIA GPU + driver ≥ 560 + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)** for GPU acceleration. No NVIDIA GPU? The launcher automatically runs the **CPU image** instead (works everywhere, just slower).
- A **Gemini** or **OpenAI** API key if you want to use those providers — they're entered in the UI, not baked into the image

> **Apple Silicon / macOS note.** Docker on macOS cannot access the GPU (no
> Metal passthrough into containers), so the Docker image runs on CPU there. To
> use the Apple GPU, run **natively** instead: `./run.sh --native` (PyTorch MPS
> accelerates TrOCR/CRNN/local-LLM; PaddleOCR detection stays on CPU — it has no
> Metal backend).

---

## Run it (one command)

Clone the repo (or download the `run.*` + `docker-compose.*.yml` files) and run
the launcher for your OS. It **detects your GPU, checks your specs before
pulling**, and starts the correct image (GPU or CPU) automatically:

```bash
# macOS / Linux / WSL
./run.sh                 # auto-detect: GPU image if an NVIDIA GPU is usable, else CPU
./run.sh --cpu           # force the CPU image
./run.sh --native        # macOS only: run natively to use the Apple GPU (MPS)
./run.sh --build         # build locally from source instead of pulling images
./run.sh --down          # stop everything
# then open http://localhost:5173
```

```powershell
# Windows (PowerShell)
.\run.ps1                # auto-detect GPU/CPU
.\run.ps1 -Cpu           # force CPU image
.\run.ps1 -Down          # stop
```

If your machine doesn't meet the GPU requirements (driver too old, no NVIDIA
Container Toolkit, too little VRAM/RAM), the launcher prints exactly what's
missing **before** downloading the multi-GB image and offers to fall back to the
CPU image.

### Under the hood: Docker Compose

The launcher just selects the right Compose file. You can run them directly:

| Host | File |
|------|------|
| NVIDIA GPU (published images) | `docker-compose.images.yml` |
| No GPU / Mac (published images) | `docker-compose.images.cpu.yml` |
| NVIDIA GPU (local build) | `docker-compose.yml` |
| No GPU / Mac (local build) | `docker-compose.cpu.yml` |

Compose wires the network, volumes, GPU, and service names for you (the
frontend reaches the backend automatically), and picks up an optional `.env`:

```bash
# Grab the compose file (or clone the repo)
curl -O https://raw.githubusercontent.com/<your-org>/RenAIssance/main/docker-compose.images.yml

docker compose -f docker-compose.images.yml pull   # get latest images
docker compose -f docker-compose.images.yml up -d   # run
# open http://localhost:5173

docker compose -f docker-compose.images.yml down     # stop (data persists)
```

That's it — skip the manual `docker run` steps below unless you specifically
want them.

### Manual `docker run` (alternative)

### Initial setup (one time only)

```bash
# Pull latest images
docker pull saarthakg004/renaissance-backend:latest
docker pull saarthakg004/renaissance-frontend:latest

# Create network and volumes (do this once — they persist forever)
docker network create renaissance 2>/dev/null || true
docker volume create paddle_models 2>/dev/null || true
docker volume create renaissance_storage 2>/dev/null || true
```

### Start the containers

```bash
# Backend with GPU support
docker run -d --name renaissance-backend \
  --gpus all \
  --network renaissance \
  --network-alias backend \
  -p 8000:8000 \
  -v paddle_models:/paddle_models \
  -v renaissance_storage:/app/storage \
  --restart unless-stopped \
  saarthakg004/renaissance-backend:latest

# NOTE: --network-alias backend is REQUIRED. The frontend's nginx proxies
# /api/ to http://backend:8000, so the backend must be reachable as "backend"
# on the network. (Compose does this automatically via the service name.)

# Frontend
docker run -d --name renaissance-frontend \
  --network renaissance \
  -p 5173:8080 \
  --restart unless-stopped \
  saarthakg004/renaissance-frontend:latest

# Wait ~30s for containers to start, then open http://localhost:5173
```

### Stop containers (data persists in volumes)

```bash
# Stop and remove only containers — volumes and data are preserved
docker rm -f renaissance-backend renaissance-frontend
```

### Restart containers (reuse existing volumes and data)

```bash
# Just run the container start commands above again
# All your datasets and transcripts will be there
```

### Clean up (⚠️ WARNING: deletes all data)

```bash
# Delete containers, network, and volumes (this removes all saved datasets/transcripts)
docker rm -f renaissance-backend renaissance-frontend
docker network rm renaissance
docker volume rm paddle_models renaissance_storage
```

**No GPU?** Drop `--gpus all` from the backend command — everything still runs, just slower.

**All commands in one script:**

```bash
# Setup (run once)
docker pull saarthakg004/renaissance-backend:latest
docker pull saarthakg004/renaissance-frontend:latest
docker network create renaissance 2>/dev/null || true
docker volume create paddle_models 2>/dev/null || true
docker volume create renaissance_storage 2>/dev/null || true

# Start
docker run -d --name renaissance-backend \
  --gpus all --network renaissance --network-alias backend -p 8000:8000 \
  -v paddle_models:/paddle_models -v renaissance_storage:/app/storage \
  --restart unless-stopped \
  saarthakg004/renaissance-backend:latest

docker run -d --name renaissance-frontend \
  --network renaissance -p 5173:8080 \
  --restart unless-stopped \
  saarthakg004/renaissance-frontend:latest

sleep 30 && echo "Open http://localhost:5173"
```

---

## How it works

A 5-step wizard, one step per page:

1. **Upload** — PDF or image files (PNG, JPG, TIFF, BMP)
2. **Select pages** — thumbnail grid, click or shift-click to pick
3. **Preprocess** — toggle and tune 7 OpenCV ops (normalize, grayscale, deskew, denoise, contrast, sharpen, binarize), preview before/after
4. **Text detection** — layout-aware line detection via PaddleOCR, pick a recognition backend
5. **OCR & export** — transcribe with the chosen provider, edit the output, download as TXT / DOCX / PDF

---

## Accounts & usage tracking

The app opens on a simple **login / signup** page (username, password, name,
email, institute). It exists only for lightweight usage tracking — no API key
is ever asked for at login (provider keys are entered later, in the OCR step).
A small **profile** menu (top-right on the home screen) lets users update their
name, email, and institute.

- **Local accounts** live in SQLite on the `storage` volume per instance.
- **Central tracking:** each signup (and profile edit) is reported to a shared
  Supabase table over its REST API using a *publishable* key baked into the
  image. That key is public by design and the table is RLS-locked
  (insert/update only — no reads/deletes), so no database password or
  service-role key is ever shipped.
- **Optional env** (via `.env` / `-e`, all backend-only): `SECRET_KEY` (stable
  session signing — otherwise sessions reset on restart), `ADMIN_TOKEN`
  (enables `GET /api/admin/users`), `DATABASE_URL` (use your own Postgres
  instead of SQLite). See `.env.example`.

## Development & tests

```bash
# Backend test suite (CPU-safe — no GPU needed). Runs in CI on every push.
cd backend
pip install -r requirements-dev.txt
pytest tests -q

# Real-GPU smoke test (run on a machine with an NVIDIA GPU):
python tests/smoke_gpu.py
```

CI (`.github/workflows/docker-build.yml`) runs the CPU test suite, builds both
the **`-gpu`** and **`-cpu`** backend image variants from the single
`backend/Dockerfile`, and boots the CPU image to verify `/api/health` before
tagging a release.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `run.sh`/`run.ps1` says "does not meet the GPU requirements" | Install/repair the NVIDIA driver (≥ 560) + Container Toolkit, or run with `--cpu` to use the CPU image |
| GPU image logs "started WITHOUT a usable CUDA device" | Container launched without GPU access — use the launcher, add `--gpus all`, or run the CPU image. The server still starts; only PaddleOCR detection is unavailable. |
| Signup/login returns **502** + nginx `backend could not be resolved` | The backend container isn't reachable as `backend`. Use Compose, or add `--network-alias backend` to the manual `docker run`. |
| Layout detection falls back to CPU (`cuda_compiled=False`) | Container launched without `--gpus all`, or host driver < 560 |
| PaddleOCR re-downloads on every start | `paddle_models` volume was removed; it will repopulate on next run |
| Port 8000/5173 already in use | Remap with `-p 8001:8000` / `-p 5174:8080` |
| Frontend says "cannot reach backend" | Backend still starting — health check takes ~30 s on first run |

View logs: `docker logs -f renaissance-backend`.
