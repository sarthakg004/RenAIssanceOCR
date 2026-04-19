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

```bash
# Pull
docker pull saarthakg004/renaissance-backend:latest
docker pull saarthakg004/renaissance-frontend:latest

# Shared network
docker network create renaissance 2>/dev/null || true

# Backend — GPU + persistent PaddleOCR model cache
docker run -d --name renaissance-backend \
  --gpus all \
  --network renaissance \
  -p 8000:8000 \
  -v paddle_models:/paddle_models \
  --restart unless-stopped \
  saarthakg004/renaissance-backend:latest

# Frontend
docker run -d --name renaissance-frontend \
  --network renaissance \
  -p 5173:80 \
  --restart unless-stopped \
  saarthakg004/renaissance-frontend:latest
```

Open **http://localhost:5173**.

**No GPU?** Drop `--gpus all` from the backend command — everything still runs,
just slower.

**Stop:**
```bash
docker rm -f renaissance-backend renaissance-frontend
```

---

## Run it (from source)

```bash
git clone https://github.com/sarthakg004/RenAIssanceOCR.git
cd RenAIssance
docker compose up --build
```

First build takes 10–15 minutes (downloads PyTorch, PaddlePaddle, and the
recognition model weights). Subsequent builds reuse the BuildKit cache.

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
| Port 8000/5173 already in use | Remap with `-p 8001:8000` / `-p 5174:80` |
| Frontend says "cannot reach backend" | Backend still starting — health check takes ~30 s on first run |

View logs: `docker logs -f renaissance-backend`.
