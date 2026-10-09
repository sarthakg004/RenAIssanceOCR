"""The PDF export must emit a well-formed, non-empty PDF."""

from app.services.export import build_pdf_export


def test_pdf_export_has_pdf_magic(sample_transcripts):
    data = build_pdf_export(sample_transcripts).getvalue()
    assert data[:4] == b"%PDF"
