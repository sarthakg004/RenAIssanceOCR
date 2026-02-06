# RenAIssance - OCR Preprocessing Studio

A modern web application for preprocessing historical documents and extracting text using Google's Gemini AI. Built with React, Vite, Tailwind CSS, and FastAPI.

![Stage 1 OCR Pipeline](https://img.shields.io/badge/Stage-1-blue) ![React](https://img.shields.io/badge/React-18.2-61dafb) ![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688) ![Gemini](https://img.shields.io/badge/Gemini-AI-4285f4)

## 🎯 Features

- **PDF & Image Upload** - Support for PDF documents and image files (PNG, JPG, TIFF)
- **Smart Page Selection** - Preview and select specific pages for processing
- **Double-Page Detection** - Automatic detection and splitting of double-page spreads
- **Image Preprocessing** - Interactive controls for:
  - Grayscale conversion
  - Contrast adjustment (CLAHE)
  - Binarization (Otsu, Adaptive, Sauvola)
  - Noise removal (Gaussian, Median, Bilateral)
  - Deskewing
  - Cropping
- **Before/After Comparison** - Visual slider to compare original and processed images
- **Gemini OCR** - Text extraction using Google's Gemini AI models
- **Transcript Editing** - Edit and refine extracted text
- **Multi-format Export** - Export transcripts as TXT, DOCX, or PDF

## 📁 Project Structure

```
RenAIssance/
├── backend/                    # FastAPI backend server
│   ├── main.py                 # API endpoints & Gemini OCR
│   ├── requirements.txt        # Python dependencies
│   └── preprocessing/          # OpenCV preprocessing module
│       ├── __init__.py         # Module exports
│       ├── operations.py       # Preprocessing operations (OpenCV)
│       ├── pipeline.py         # Pipeline executor
│       └── progress.py         # Progress tracking utilities
│
├── ocr-preprocess-ui/          # React frontend application
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   │   ├── Stepper.jsx           # Progress stepper
│   │   │   ├── UploadZone.jsx        # File upload dropzone
│   │   │   ├── PageCard.jsx          # Page thumbnail card
│   │   │   ├── PdfPreviewGrid.jsx    # PDF page grid
│   │   │   ├── PreprocessPanel.jsx   # Preprocessing controls
│   │   │   ├── OperationControl.jsx  # Individual operation control
│   │   │   ├── ImageCompare.jsx      # Before/after slider
│   │   │   ├── ModelSelector.jsx     # Gemini model selector
│   │   │   ├── TranscriptEditor.jsx  # Text editor component
│   │   │   ├── RateLimitTimer.jsx    # API rate limit indicator
│   │   │   └── CombinedExportPanel.jsx # Export options
│   │   │
│   │   ├── pages/              # Page components
│   │   │   ├── UploadPage.jsx        # Step 1: Upload
│   │   │   ├── SelectPage.jsx        # Step 2: Page selection
│   │   │   ├── PreprocessPage.jsx    # Step 3: Preprocessing
│   │   │   ├── TextDetectionPage.jsx # Step 4: Method selection
│   │   │   └── TextRecognitionPage.jsx # Step 5: OCR & export
│   │   │
│   │   ├── services/           # API services
│   │   │   ├── api.js               # Preprocessing API (calls backend)
│   │   │   └── geminiApi.js         # Gemini OCR API client
│   │   │
│   │   ├── hooks/              # Custom React hooks
│   │   │   └── usePdfPreview.js     # PDF extraction hook
│   │   │
│   │   ├── App.jsx             # Main application component
│   │   ├── main.jsx            # React entry point
│   │   └── index.css           # Global styles
│   │
│   ├── package.json            # Node.js dependencies
│   ├── vite.config.js          # Vite configuration
│   ├── tailwind.config.js      # Tailwind CSS configuration
│   └── postcss.config.js       # PostCSS configuration
│
├── src/                        # Python preprocessing utilities
│   ├── dataUtils.py            # Image preprocessing functions
│   └── textDetection.py        # Text detection utilities
│
├── data/                       # Data directories
│   ├── 1.raw/                  # Raw uploaded files
│   ├── 2.images/               # Extracted/uploaded images
│   └── 3.processed/            # Processed output
│
├── CRAFT-pytorch/              # CRAFT text detection model (future)
├── experimentation.ipynb       # Jupyter notebook for experiments
├── .env                        # Environment variables
└── README.md                   # This file
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.x
- **Python** >= 3.10
- **npm** or **yarn**
- **Gemini API Key** - Get one from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Installation

#### 1. Clone the repository

```bash
git clone <repository-url>
cd RenAIssance
```

#### 2. Set up the Backend

```bash
# Navigate to backend directory
cd backend

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Or install directly
pip install fastapi uvicorn python-multipart google-genai python-docx reportlab pillow
```

#### 3. Set up the Frontend

```bash
# Navigate to frontend directory
cd ocr-preprocess-ui

# Install dependencies
npm install
```

#### 4. Configure Environment

Create a `.env` file in the root directory:

```env
GEMINI_API_KEY="your-gemini-api-key-here"
```

> **Note:** The API key is entered in the UI during the OCR step, not read from the `.env` file automatically.

## 🏃 Running the Application

You need to run both the backend and frontend servers.

### Terminal 1 - Start Backend Server

```bash
cd /home/sarthak/Documents/RenAIssance/backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The backend API will be available at `http://localhost:8000`

### Terminal 2 - Start Frontend Server

```bash
cd /home/sarthak/Documents/RenAIssance/ocr-preprocess-ui
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Open in Browser

Navigate to **http://localhost:5173** to use the application.

## 📖 Usage Guide

### Step 1: Upload
- Drag & drop or click to upload a PDF or image files
- Supported formats: PDF, PNG, JPG, JPEG, TIFF, BMP

### Step 2: Select Pages
- Preview all extracted pages
- Click to select/deselect pages for processing
- Double-page spreads are automatically detected and can be split

### Step 3: Preprocess
- Apply various image enhancement operations
- Use the slider to compare before/after results
- Click "Apply Recommended to All" for quick setup
- Skip preprocessing if images are already clean

### Step 4: Text Detection
- Choose between Gemini API (recommended) or Local Model (coming soon)
- Gemini API provides state-of-the-art accuracy

### Step 5: OCR & Export
- Enter your Gemini API key
- Select a model (Gemini 3 Flash Preview recommended)
- Process pages one by one or use "Process All"
- Edit transcripts as needed
- Export combined transcript as TXT, DOCX, or PDF

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/models` | GET | List available Gemini models |
| `/api/rate-limit-status` | GET | Check rate limit status |
| `/api/validate-key` | POST | Validate Gemini API key |
| `/api/gemini-ocr-base64` | POST | Process image with OCR |
| `/api/preprocess` | POST | Apply preprocessing pipeline |
| `/api/preprocess/operations` | GET | List available operations |
| `/api/preprocess/validate` | POST | Validate pipeline config |
| `/api/export/txt` | POST | Export as plain text |
| `/api/export/docx` | POST | Export as Word document |
| `/api/export/pdf` | POST | Export as PDF |

## 🔄 Preprocessing System

Preprocessing is now fully backend-powered using Python OpenCV. The UI remains unchanged, but all image processing operations are executed on the server for consistent, high-quality results.

### Available Operations

| Operation | Description | Parameters |
|-----------|-------------|------------|
| `normalize` | Normalize brightness/contrast levels | `strength` (0-100) |
| `grayscale` | Convert to grayscale | - |
| `deskew` | Auto-correct image rotation | `maxAngle` (1-45°) |
| `denoise` | Remove noise, preserve text | `method` (nlm/bilateral/gaussian), `strength` (1-20) |
| `contrast` | CLAHE contrast enhancement | `clipLimit` (1-10), `tileSize` (2-16) |
| `sharpen` | Sharpen text edges | `amount` (0-100%), `radius` (0.5-3px) |
| `threshold` | Binarization | `method` (otsu/adaptive/sauvola), `blockSize`, `k` |

### Pipeline Configuration Format

```json
{
  "image_data": "data:image/png;base64,...",
  "operations": [
    {"op": "grayscale", "params": {}, "enabled": true},
    {"op": "deskew", "params": {"maxAngle": 15}, "enabled": true},
    {"op": "denoise", "params": {"method": "nlm", "strength": 10}, "enabled": true},
    {"op": "contrast", "params": {"clipLimit": 2, "tileSize": 8}, "enabled": true},
    {"op": "threshold", "params": {"method": "otsu"}, "enabled": true}
  ],
  "preview_mode": false
}
```

### Progress Reporting

The preprocessing endpoint returns detailed progress information:

```json
{
  "success": true,
  "processed_image": "data:image/png;base64,...",
  "processing_time_ms": 450,
  "progress_info": {
    "total_duration_ms": 450,
    "steps": [
      {"step": "grayscale", "duration_ms": 25, "success": true},
      {"step": "deskew", "duration_ms": 180, "success": true},
      {"step": "denoise", "duration_ms": 200, "success": true}
    ]
  },
  "errors": []
}
```

### Adding New Operations

To add a new preprocessing operation:

1. **Create the function** in `backend/preprocessing/operations.py`:
```python
def my_operation(
    img: np.ndarray,
    params: Dict[str, Any],
    progress: ProgressCallbackType = None
) -> np.ndarray:
    if progress:
        progress(0.1, "Starting operation")
    
    # Your OpenCV processing here
    result = cv2.someOperation(img)
    
    if progress:
        progress(1.0, "Operation complete")
    
    return result
```

2. **Register the operation** in the `OP_REGISTRY`:
```python
OP_REGISTRY = {
    # ... existing operations ...
    "my_operation": my_operation,
}
```

3. **Add UI controls** in `ocr-preprocess-ui/src/config/preprocessOperations.js`:
```javascript
{
  id: 'my_operation',
  name: 'My Operation',
  category: 'enhancement',
  tooltip: 'Description of what this operation does.',
  controls: [
    {
      id: 'param1',
      label: 'Parameter 1',
      type: 'slider',
      min: 0,
      max: 100,
      default: 50,
    },
  ],
  defaultParams: { param1: 50 },
}
```

### Architecture Overview

```
Frontend (React)                    Backend (FastAPI)
┌─────────────────┐                ┌─────────────────────┐
│  PreprocessPage │                │   preprocessing/    │
│                 │   HTTP POST    │                     │
│  usePipeline    │───────────────▶│   operations.py     │
│                 │   /api/        │   (OpenCV funcs)    │
│  api.js         │   preprocess   │                     │
│                 │◀───────────────│   pipeline.py       │
│  Before/After   │   base64 img   │   (executor)        │
│  Viewer         │                │                     │
└─────────────────┘                └─────────────────────┘
```

## ⚙️ Available Gemini Models

| Model | Description |
|-------|-------------|
| `gemini-3-flash-preview` | Latest and fastest (default) |
| `gemini-3-pro-preview` | Most capable preview model |
| `gemini-2.5-pro` | Stable pro model |
| `gemini-2.5-flash` | Stable flash model |

## 🛠️ Tech Stack

### Frontend
- **React 18** - UI framework
- **Vite 5** - Build tool
- **Tailwind CSS 3** - Styling
- **PDF.js 4** - PDF rendering
- **Lucide React** - Icons

### Backend
- **FastAPI** - API framework
- **Uvicorn** - ASGI server
- **Google GenAI** - Gemini API client
- **OpenCV** - Image preprocessing (server-side)
- **NumPy** - Numerical operations
- **python-docx** - DOCX generation
- **ReportLab** - PDF generation
- **Pillow** - Image processing

## 📝 Rate Limiting

The backend implements a 20-second cooldown between OCR requests to comply with Gemini API free tier limits. The UI displays a countdown timer when rate limited.

## 🐛 Troubleshooting

### Backend not starting
```bash
# Make sure you're in the backend directory
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Port already in use
```bash
# Kill existing process
pkill -f "uvicorn main:app"
# Or use a different port
python -m uvicorn main:app --port 8001
```

### Frontend can't connect to backend
- Ensure backend is running on port 8000
- Check CORS settings in `backend/main.py`
- Verify no firewall blocking localhost

### PDF pages not loading
- Check browser console for errors
- Ensure PDF.js worker is loading correctly
- Try a different PDF file

## 📄 License

This project is part of the RenAIssance historical document digitization initiative.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

---

**Built with ❤️ for historical document preservation**
