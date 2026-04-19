# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RenAIssance is a full-stack web application for preprocessing historical documents and extracting text using multiple AI providers. The workflow is a 5-step wizard: Upload → Select Pages → Preprocess → Text Detection → OCR & Export.

## Commands

### Running the Application

```bash
# Full stack (recommended — Docker handles GPU, models, and networking)
docker-compose up --build   # First time or after dependency changes
docker-compose up           # Subsequent runs
docker-compose down         # Stop services
```

Services: backend (FastAPI) on port 8000, frontend (Vite/Nginx) on port 5173.

### Frontend Development

```bash
cd frontend
npm run dev      # Vite dev server
npm run build    # Production build
npm run preview  # Preview production build
```

### Backend Development

```bash
cd backend
python -m uvicorn app.main:app --reload   # Hot-reload dev server
```

GPU support requires NVIDIA driver ≥560, CUDA 12.6, and NVIDIA Container Toolkit. PaddleOCR models are cached in the `paddle_models` Docker named volume and pre-downloaded at image build time.

## Architecture

### 5-Step Frontend Wizard

`frontend/src/App.jsx` manages global wizard state and routes between steps:
1. **Upload** (`features/upload/pages/UploadPage.jsx`) — PDF/image ingestion via PDF.js (`hooks/usePdfPreview.js`)
2. **Select** (`features/upload/pages/SelectPage.jsx`) — thumbnail grid, page picking
3. **Preprocess** (`features/preprocess/pages/PreprocessPage.jsx`) — full-screen 3-panel editor
4. **Text Detection** (`features/ocr/pages/TextDetectionPage.jsx`) — layout-aware detection with PaddleOCR
5. **OCR & Export** (`features/ocr/pages/TextRecognitionPage.jsx`) — transcription + download

### Backend Structure

`backend/app/main.py` mounts 6 routers: `health`, `ocr`, `preprocess`, `export`, `layout_detection`, `recognition`, `dataset`.

**OCR Providers** — Strategy + Factory pattern:
- `services/ocr/base.py`: `BaseOCRProvider` ABC
- `services/ocr/factory.py`: `OCRFactory` registry
- Implementations: `gemini.py` (google-genai SDK), `chatgpt.py`, `deepseek.py`, `qwen.py` (all httpx)
- To add a new provider: implement `BaseOCRProvider`, register in `OCRFactory`

**Preprocessing Pipeline** (`preprocessing/`):
- `operations.py`: 7 OpenCV ops (normalize, grayscale, deskew, denoise, contrast, sharpen, binarize) registered in `OP_REGISTRY`
- `pipeline.py`: `PipelineExecutor` runs ops sequentially
- `progress.py`: timing and progress tracking

**Local Recognition Models** (`services/recognition/`):
- `crnn_inference.py`: CRNN for handwritten text
- `trocr_inference.py`: TrOCR transformer model
- Weights live in `models/weights/`

**Rate Limiting** (`core/rate_limiter.py`): Sliding-window limiter, default 5 req/60s (Gemini free tier). Configurable in `core/config.py`.

### API Keys

Keys are passed per-request from frontend headers, extracted in `api/deps.py`. Environment variables are loaded from `.env` at startup. The required keys are `GEMINI_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `QWEN_API_KEY`.

### CI/CD

`.github/workflows/docker-build.yml` — triggers on push to `main`:
1. Computes next semver `v3.x` tag from existing tags
2. Builds backend and frontend images in parallel → pushes to Docker Hub (`saarthakg004/renaissance-backend`, `saarthakg004/renaissance-frontend`)
3. Creates and pushes git tag only if both builds succeed

### Known Disabled Features

DeepSeek and Qwen providers are implemented in the backend but disabled in the frontend UI (`features/ocr/config/providers.js`).

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS 3.4, PDF.js |
| Backend | FastAPI 0.115, Python 3.11, Uvicorn |
| OCR/AI | PaddleOCR 3.0, PyTorch 2.5.1, Transformers 4.46, google-genai |
| Image Processing | OpenCV 4.10 (headless), Pillow, NumPy |
| Export | python-docx, ReportLab, PyMuPDF |
| Infrastructure | Docker multi-stage builds, NVIDIA CUDA 12.6, GitHub Actions |
