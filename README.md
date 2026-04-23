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
  -p 8000:8000 \
  -v paddle_models:/paddle_models \
  -v renaissance_storage:/app/storage \
  --restart unless-stopped \
  saarthakg004/renaissance-backend:latest

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
  --gpus all --network renaissance -p 8000:8000 \
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

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits immediately on `--gpus all` | NVIDIA Container Toolkit not installed or Docker not restarted after install |
| Layout detection falls back to CPU (`cuda_compiled=False`) | Container launched without `--gpus all`, or host driver < 560 |
| PaddleOCR re-downloads on every start | `paddle_models` volume was removed; it will repopulate on next run |
| Port 8000/5173 already in use | Remap with `-p 8001:8000` / `-p 5174:8080` |
| Frontend says "cannot reach backend" | Backend still starting — health check takes ~30 s on first run |

View logs: `docker logs -f renaissance-backend`.
