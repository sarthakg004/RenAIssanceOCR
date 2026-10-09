"""Render the per-page transcripts into one PDF."""

import io
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.units import inch

from ..core.font_registry import UNICODE_FONT_REGISTERED


def _page_sort_key(x: str):
    """Sort key that handles numeric ('5') and split page keys ('5a', '5b')."""
    match = re.match(r'^(\d+)(.*)', x)
    if match:
        return (int(match.group(1)), match.group(2))
    return (0, x)


def build_pdf_export(transcripts: dict) -> io.BytesIO:
    """Needs DejaVu Sans registered, or accents fall back to Helvetica."""
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=inch,
        leftMargin=inch,
        topMargin=inch,
        bottomMargin=inch
    )

    styles = getSampleStyleSheet()

    font_name = 'DejaVuSans' if UNICODE_FONT_REGISTERED else 'Helvetica'

    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontName=font_name,
        fontSize=18,
        spaceAfter=30,
        alignment=1  # center
    )

    page_header_style = ParagraphStyle(
        'PageHeader',
        parent=styles['Heading2'],
        fontName=font_name,
        fontSize=14,
        spaceAfter=6,
        textColor='#1e40af'
    )

    body_style = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontName=font_name,
        fontSize=11,
        spaceAfter=6,
        leading=14
    )

    separator_style = ParagraphStyle(
        'Separator',
        parent=styles['Normal'],
        fontName=font_name,
        fontSize=10,
        spaceAfter=12,
        textColor='#6b7280'
    )

    story = []
    story.append(Paragraph("Combined Transcript", title_style))
    story.append(Spacer(1, 20))

    pages = sorted(transcripts.keys(), key=_page_sort_key)

    for page in pages:
        text = transcripts[page]

        story.append(Paragraph(f"Page {page}", page_header_style))
        story.append(Paragraph("─" * 50, separator_style))

        # reportlab parses a mini-HTML in Paragraph, so escape the text first.
        for line in text.split('\n'):
            if line.strip():
                safe_line = line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                story.append(Paragraph(safe_line, body_style))
            else:
                story.append(Spacer(1, 6))

        story.append(Spacer(1, 30))

    doc.build(story)
    buffer.seek(0)
    return buffer
