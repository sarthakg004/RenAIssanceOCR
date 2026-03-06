"""
Dataset Generation API Router — transcript parsing + dataset export endpoints.
"""

import base64
import traceback
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..services.transcript_parser import parse_transcript_bytes, extract_text, parse_transcript
from ..services.dataset_builder import (
    align_boxes_with_transcript,
    sort_boxes_reading_order,
    build_dataset_zip,
)


router = APIRouter(prefix="/api/dataset", tags=["dataset"])


# ── Schemas ─────────────────────────────────────────────────────────

class TranscriptParseResponse(BaseModel):
    success: bool
    pages: dict  # {page_key: [lines]}
    page_count: int
    total_lines: int
    error: Optional[str] = None


class AlignmentRequest(BaseModel):
    boxes: list  # list of 4-point polygons
    lines: list  # list of transcript strings


class AlignmentResponse(BaseModel):
    success: bool
    pairs: list  # [(box, text), ...]
    num_boxes: int
    num_lines: int
    num_pairs: int
    warning: Optional[str] = None


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
    """
    Upload a transcript file and parse it into page→lines mapping.

    Accepts TXT, DOCX, PDF, Markdown files.
    """
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


@router.post("/parse-transcript-text", response_model=TranscriptParseResponse)
async def parse_transcript_text_endpoint(
    text: str = Form(...),
):
    """
    Parse raw transcript text (pasted) into page→lines mapping.
    """
    try:
        pages = parse_transcript(text)
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


@router.post("/align", response_model=AlignmentResponse)
async def align_endpoint(request: AlignmentRequest):
    """
    Align bounding boxes with transcript lines for a single page.
    Returns the aligned pairs and mismatch info.
    """
    try:
        pairs, num_boxes, num_lines = align_boxes_with_transcript(
            request.boxes, request.lines
        )

        warning = None
        if num_boxes != num_lines:
            warning = (
                f"Mismatch: {num_boxes} bounding boxes vs {num_lines} transcript lines. "
                f"Only {len(pairs)} pairs will be used."
            )

        return AlignmentResponse(
            success=True,
            pairs=[{"box": box, "text": text} for box, text in pairs],
            num_boxes=num_boxes,
            num_lines=num_lines,
            num_pairs=len(pairs),
            warning=warning,
        )
    except Exception as e:
        traceback.print_exc()
        return AlignmentResponse(
            success=False,
            pairs=[],
            num_boxes=0,
            num_lines=0,
            num_pairs=0,
            warning=str(e),
        )


@router.post("/export")
async def export_dataset(request: DatasetExportRequest):
    """
    Generate and download an OCR training dataset as a ZIP archive.

    Exports line crops and labels in a structured ZIP.
    """
    if not request.pages:
        raise HTTPException(status_code=400, detail="No pages provided.")

    try:
        pages_data = [p.dict() for p in request.pages]

        zip_buffer = build_dataset_zip(
            pages_data=pages_data,
            book_name=request.book_name,
        )

        filename = f"{request.book_name}_dataset.zip"

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Dataset generation failed: {str(e)}")
