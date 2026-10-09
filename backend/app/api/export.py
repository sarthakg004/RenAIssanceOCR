"""Download the combined transcript as a PDF (TXT export happens in the browser)."""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ..schemas.ocr import ExportRequest
from ..services.export import build_pdf_export

router = APIRouter()


@router.post("/api/export/pdf")
async def export_pdf(request: ExportRequest):
    return StreamingResponse(
        build_pdf_export(request.transcripts),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=transcript_full.pdf"},
    )
