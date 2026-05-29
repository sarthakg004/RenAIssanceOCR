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
- **NVIDIA GPU + driver ≥ 560 + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)** (optional but strongly recommended; CPU works but layout detection is slow)
- A **Gemini** or **OpenAI** API key if you want to use those providers — they're entered in the UI, not baked into the image

---

## Run it (prebuilt images)

### Recommended: Docker Compose

The simplest way — Compose wires the network, volumes, GPU, and service names
for you (the frontend reaches the backend automatically), and picks up an
optional `.env`:

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

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits immediately on `--gpus all` | NVIDIA Container Toolkit not installed or Docker not restarted after install |
| Signup/login returns **502** + nginx `backend could not be resolved` | The backend container isn't reachable as `backend`. Use Compose, or add `--network-alias backend` to the manual `docker run`. |
| Layout detection falls back to CPU (`cuda_compiled=False`) | Container launched without `--gpus all`, or host driver < 560 |
| PaddleOCR re-downloads on every start | `paddle_models` volume was removed; it will repopulate on next run |
| Port 8000/5173 already in use | Remap with `-p 8001:8000` / `-p 5174:8080` |
| Frontend says "cannot reach backend" | Backend still starting — health check takes ~30 s on first run |

View logs: `docker logs -f renaissance-backend`.
