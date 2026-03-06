"""
Transcript Parser Service

Parses transcript files (TXT, DOCX, PDF, Markdown) and splits them
into per-page line lists using page markers.

Supported markers (all case-insensitive, delimiters flexible):
  "PDF p1"
  "PDF p2 - left"   /  "PDF p2 left"
  "PDF p3 - right"  /  "PDF p3 right"
  "--- Page 4 ---"  /  "--- page 4 - left ---"
  "[Page 5]"        /  "[Page 5 - right]"
  "Page 6"          (bare)
  "p1", "p1 left", "p1-right"  (shorthand)
"""

import io
import re
from typing import Dict, List, Optional


# ── Page-marker patterns ────────────────────────────────────────────
# Side group: optional separator (space/dash/–/—) followed by left|right
_SIDE_SUFFIX = r"(?:[\s\-–—]+(?P<side>left|right))?"

_PAGE_PATTERNS = [
    # "PDF p1", "PDF p2 - left", "PDF p2 left"
    re.compile(
        r"^\s*PDF\s+p\s*(?P<num>\d+)" + _SIDE_SUFFIX + r"\s*$",
        re.IGNORECASE,
    ),
    # "--- Page 4 ---" or "--- page 4 left ---" or "--- page 4 - right ---"
    re.compile(
        r"^\s*-{2,}\s*[Pp]age\s+(?P<num>\d+)" + _SIDE_SUFFIX + r"\s*-*\s*$",
        re.IGNORECASE,
    ),
    # "[Page 5]" or "[Page 5 - left]" or "[Page 5 right]"
    re.compile(
        r"^\s*\[\s*[Pp]age\s+(?P<num>\d+)" + _SIDE_SUFFIX + r"\s*\]\s*$",
        re.IGNORECASE,
    ),
    # Bare "Page 6" / "Page 6 left" / "page 6 - right"
    re.compile(
        r"^\s*[Pp]age\s+(?P<num>\d+)" + _SIDE_SUFFIX + r"\s*$",
        re.IGNORECASE,
    ),
    # Shorthand "p1" / "p1 left" / "p1-right"
    re.compile(
        r"^\s*[Pp](?P<num>\d+)" + _SIDE_SUFFIX + r"\s*$",
        re.IGNORECASE,
    ),
]


def _match_page_marker(line: str) -> Optional[str]:
    """Return a page key (e.g. '3', '3_left') if *line* is a page marker."""
    for pat in _PAGE_PATTERNS:
        m = pat.match(line)
        if m:
            page_num = m.group("num")
            try:
                side = m.group("side")
            except IndexError:
                side = None
            if side:
                return f"{page_num}_{side.lower()}"
            return page_num
    return None


# ── Raw text extraction per format ──────────────────────────────────

def _extract_text_from_txt(data: bytes) -> str:
    """Decode plain-text bytes (UTF-8 with BOM tolerance)."""
    text = data.decode("utf-8-sig", errors="replace")
    return text


def _extract_text_from_docx(data: bytes) -> str:
    """Extract all paragraph text from a .docx file."""
    from docx import Document

    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs)


def _extract_text_from_pdf(data: bytes) -> str:
    """Extract text from each page of a PDF (using PyMuPDF / fitz)."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise RuntimeError(
            "PyMuPDF (fitz) is required to parse PDF transcripts. "
            "Install it with: pip install PyMuPDF"
        )
    doc = fitz.open(stream=data, filetype="pdf")
    pages_text = []
    for page in doc:
        pages_text.append(page.get_text())
    doc.close()
    return "\n".join(pages_text)


def _extract_text_from_markdown(data: bytes) -> str:
    """Markdown is plain text — just decode."""
    return data.decode("utf-8-sig", errors="replace")


_EXTRACTORS = {
    "text/plain": _extract_text_from_txt,
    "text/markdown": _extract_text_from_markdown,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": _extract_text_from_docx,
    "application/pdf": _extract_text_from_pdf,
}

# Extension-based fallback
_EXT_MAP = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
}


def extract_text(data: bytes, filename: str = "", content_type: str = "") -> str:
    """
    Extract raw text from transcript file bytes.
    Falls back based on filename extension if content_type is ambiguous.
    """
    mime = content_type.lower().split(";")[0].strip() if content_type else ""

    if mime not in _EXTRACTORS:
        # Try extension
        import os
        ext = os.path.splitext(filename)[1].lower()
        mime = _EXT_MAP.get(ext, "text/plain")

    extractor = _EXTRACTORS.get(mime, _extract_text_from_txt)
    return extractor(data)


# ── Split into pages ────────────────────────────────────────────────

def parse_transcript(
    raw_text: str,
    default_page: str = "1",
) -> Dict[str, List[str]]:
    """
    Split *raw_text* into ``{page_key: [lines]}`` using embedded page markers.

    If no page markers are found the whole text goes under *default_page*.
    Empty lines are removed; whitespace is normalised (strip).
    """
    pages: Dict[str, List[str]] = {}
    lines = raw_text.splitlines()
    has_any_marker = any(_match_page_marker(line) is not None for line in lines)

    # If there are page markers, ignore preface lines before first marker.
    # If there are no markers at all, keep backward-compatible fallback
    # and put everything under default_page.
    current_key: Optional[str] = None if has_any_marker else default_page

    for raw_line in lines:
        marker = _match_page_marker(raw_line)
        if marker is not None:
            current_key = marker
            continue

        # Skip lines that appear before any page marker
        if current_key is None:
            continue

        cleaned = raw_line.strip()
        if not cleaned:
            continue
        # Strip "END OF EXTRACT" marker lines (and stop collecting for this page)
        if re.match(r"^end\s+of\s+extract\s*$", cleaned, re.IGNORECASE):
            continue
        pages.setdefault(current_key, []).append(cleaned)

    return pages


def parse_transcript_bytes(
    data: bytes,
    filename: str = "",
    content_type: str = "",
) -> Dict[str, List[str]]:
    """Convenience: extract text then parse into page→lines dict."""
    raw = extract_text(data, filename, content_type)
    return parse_transcript(raw)
