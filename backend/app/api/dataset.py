"""Parse transcripts and export OCR training datasets as ZIPs."""

import logging
import re
import traceback
import urllib.parse
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.transcript_parser import parse_transcript_bytes
from ..services.dataset_builder import build_dataset_zip, build_detection_dataset_zip
from ..storage.storage_manager import save_detection_dataset, save_recognition_dataset


router = APIRouter(prefix="/api/dataset", tags=["dataset"])
logger = logging.getLogger(__name__)


# ── Schemas ─────────────────────────────────────────────────────────

class TranscriptParseResponse(BaseModel):
    success: bool
    pages: dict  # {page_key: [lines]}
    page_count: int
    total_lines: int
    error: Optional[str] = None


class PageDataItem(BaseModel):
    page_key: str
    image_data: str  # base64 data URL
    boxes: list  # list of 4-pt polygons
    lines: list  # list of transcript strings


class DatasetExportRequest(BaseModel):
    pages: List[PageDataItem]
    book_name: str = "dataset"


# ── Endpoints ───────────────────────────────────────────────────────

@router.post("/parse-transcript", response_model=TranscriptParseResponse)
async def parse_transcript_endpoint(
    file: UploadFile = File(...),
):
    """Parse an uploaded TXT/DOCX/PDF/Markdown transcript into page -> lines."""
    try:
        data = await file.read()
        filename = file.filename or ""
        content_type = file.content_type or ""

        pages = parse_transcript_bytes(data, filename, content_type)

        total_lines = sum(len(v) for v in pages.values())

        return TranscriptParseResponse(
            success=True,
            pages=pages,
            page_count=len(pages),
            total_lines=total_lines,
        )
    except Exception as e:
        traceback.print_exc()
        return TranscriptParseResponse(
            success=False,
            pages={},
            page_count=0,
            total_lines=0,
            error=str(e),
        )


@router.post("/export")
async def export_dataset(request: DatasetExportRequest):
    """Build and stream a recognition dataset ZIP (line crops + labels)."""
    if not request.pages:
        raise HTTPException(status_code=400, detail="No pages provided.")

    try:
        pages_data = [p.dict() for p in request.pages]

        zip_buffer = build_dataset_zip(
            pages_data=pages_data,
            book_name=request.book_name,
        )

        try:
            save_recognition_dataset(
                pages_data=pages_data,
                source="dataset export",
                book_name=request.book_name,
            )
        except Exception as save_err:
            logger.warning("Recognition dataset persistence failed: %s", save_err)

        filename = f"{request.book_name}_dataset.zip"
        # Content-Disposition must be latin-1; the RFC 5987 form carries the
        # real name for clients that understand it.
        ascii_filename = re.sub(r'[^\x20-\x7E]', '_', filename)
        utf8_filename = urllib.parse.quote(filename)
        content_disp = (
            f'attachment; filename="{ascii_filename}"; '
            f"filename*=UTF-8''{utf8_filename}"
        )

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": content_disp},
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Dataset generation failed: {str(e)}")


# ── Detection-only dataset export ──────────────────────────────────

class DetectionPageItem(BaseModel):
    page_key: str
    image_data: str  # base64 data URL
    boxes: list  # list of 4-pt polygons


class DetectionExportRequest(BaseModel):
    pages: List[DetectionPageItem]
    book_name: str = "dataset"
    # "txt" → one "x1 y1 x2 y2" per line; "json" → array of [x1,y1,x2,y2].
    bbox_format: str = "txt"


@router.post("/export-detection")
async def export_detection_dataset(request: DetectionExportRequest):
    """Build and stream a detection dataset ZIP. Boxes only, no transcript."""
    if not request.pages:
        raise HTTPException(status_code=400, detail="No pages provided.")

    try:
        pages_data = [p.dict() for p in request.pages]

        zip_buffer = build_detection_dataset_zip(
            pages_data=pages_data,
            book_name=request.book_name,
            bbox_format=request.bbox_format,
        )

        try:
            save_detection_dataset(
                pages_data=pages_data,
                source="dataset export",
                book_name=request.book_name,
                bbox_format=request.bbox_format,
            )
        except Exception as save_err:
            logger.warning("Detection dataset persistence failed: %s", save_err)

        filename = f"{request.book_name}_detection_dataset.zip"
        ascii_filename = re.sub(r'[^\x20-\x7E]', '_', filename)
        utf8_filename = urllib.parse.quote(filename)
        content_disp = (
            f'attachment; filename="{ascii_filename}"; '
            f"filename*=UTF-8''{utf8_filename}"
        )

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": content_disp},
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Detection dataset generation failed: {str(e)}")
