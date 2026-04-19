"""
Prompt templates for LLM-based OCR post-processing.

Each template instructs the LLM to improve OCR text without hallucinating or
adding new content. The model must preserve the original structure.
"""

TEMPLATES = {
    "full_cleanup": {
        "name": "Full Cleanup",
        "description": "Fix spelling, formatting, and OCR artifacts in one pass",
        "prompt": (
            "You are an OCR post-processing assistant. "
            "Clean up the following OCR-extracted text:\n"
            "- Fix obvious OCR errors and misspellings\n"
            "- Fix incorrect character substitutions (e.g., 'rn' misread as 'm', '1' as 'l')\n"
            "- Normalize inconsistent spacing and line breaks\n"
            "- Preserve the original paragraph structure and meaning\n"
            "- Do NOT add, remove, or rephrase any content\n"
            "- Do NOT add commentary or explanations\n"
            "- Return ONLY the corrected text\n\n"
            "OCR text to clean:\n\n"
        ),
    },
    "spelling_correction": {
        "name": "Spelling Correction",
        "description": "Fix only spelling errors and character misrecognitions",
        "prompt": (
            "You are a spelling correction assistant for OCR output. "
            "Fix ONLY spelling errors and character misrecognitions in the following text. "
            "Do not change formatting, line breaks, or paragraph structure. "
            "Do not add, remove, or rephrase any content. "
            "Return ONLY the corrected text.\n\n"
            "Text:\n\n"
        ),
    },
    "formatting": {
        "name": "Format & Structure",
        "description": "Clean up line breaks, spacing, and paragraph structure",
        "prompt": (
            "You are a text formatting assistant for OCR output. "
            "Clean up the formatting of the following OCR-extracted text:\n"
            "- Merge lines that were incorrectly split mid-sentence\n"
            "- Preserve intentional paragraph breaks\n"
            "- Normalize spacing (remove extra spaces, fix missing spaces)\n"
            "- Do NOT change any words or fix spelling\n"
            "- Return ONLY the reformatted text\n\n"
            "Text:\n\n"
        ),
    },
    "historical_normalization": {
        "name": "Historical Text Normalization",
        "description": "Normalize archaic spellings and historical typography",
        "prompt": (
            "You are a historical text normalization assistant. "
            "Normalize the following OCR-extracted historical text:\n"
            "- Normalize long-s (\u017f) to modern 's'\n"
            "- Expand common ligatures (\ufb00\u2192ff, \ufb01\u2192fi, \ufb02\u2192fl, \ufb03\u2192ffi, \ufb04\u2192ffl)\n"
            "- Normalize archaic letter forms while preserving meaning\n"
            "- Fix OCR errors specific to historical typefaces\n"
            "- Preserve the original structure and line breaks\n"
            "- Do NOT modernize vocabulary or grammar\n"
            "- Return ONLY the normalized text\n\n"
            "Text:\n\n"
        ),
    },
}


def get_template(name: str) -> str:
    """Return the prompt string for the given template name."""
    entry = TEMPLATES.get(name, TEMPLATES["full_cleanup"])
    return entry["prompt"]


def list_templates() -> list:
    """Return a list of available template metadata."""
    return [
        {"id": key, "name": val["name"], "description": val["description"]}
        for key, val in TEMPLATES.items()
    ]
