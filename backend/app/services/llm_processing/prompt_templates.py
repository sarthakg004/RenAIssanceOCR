"""
Prompt templates for LLM-based OCR post-processing.

Each template instructs the LLM to improve OCR text without hallucinating or
adding new content. The model must preserve the original structure.

IMPORTANT — line count is sacred. The app sends a whole-page transcript with
ONE line per text region detected by the layout-detection (PaddleOCR) step, and
maps each returned line back onto the same region by position. So every template
gets the same non-negotiable line-preservation contract appended by
`get_template()`: the model may correct text *within* a line but must return the
exact same number of lines, in the same order. The finetuned local model
(`local_es`) does not use these templates — it corrects line-by-line directly.
"""

# Appended to every template. The whole page is sent for context, but the line
# structure is fixed by text detection and must survive verbatim.
_LINE_PRESERVATION = (
    "\n\nCRITICAL — DO NOT CHANGE THE NUMBER OF LINES:\n"
    "The transcript below has exactly one line per text region detected on the "
    "page. That line count is fixed and correct — it comes from the layout "
    "detection step, not from you. Rules:\n"
    "- Return EXACTLY the same number of lines, in the same order.\n"
    "- Each input line maps to one output line. Correct text only WITHIN a line.\n"
    "- NEVER merge two lines into one, split one line into two, reorder, add, or "
    "delete a line — not even blank lines.\n"
    "- If a line seems to end mid-word or mid-sentence, leave it as-is on its "
    "own line; the next line continues it.\n"
    "- Read the whole page for context (to disambiguate glyphs and words), but "
    "edit each line independently.\n"
    "- Output ONLY the corrected lines, separated by single newlines. No "
    "numbering, no commentary, no code fences.\n\n"
    "Transcript (one line per detected region):\n\n"
)

TEMPLATES = {
    "full_cleanup": {
        "name": "Full Cleanup",
        "description": "Fix spelling, formatting, and OCR artifacts in one pass",
        "prompt": (
            "You are an OCR post-processing assistant for historical Spanish "
            "documents. Clean up the OCR-extracted transcript:\n"
            "- Fix obvious OCR errors and misspellings\n"
            "- Fix incorrect character substitutions (e.g., 'rn' misread as 'm', '1' as 'l', long-s 'ſ' as 's')\n"
            "- Restore diacritics that OCR dropped (á é í ó ú ñ ç)\n"
            "- Normalize inconsistent spacing within a line\n"
            "- Preserve the original early-modern spelling and meaning\n"
            "- Do NOT translate, modernise, rephrase, add or remove content"
        ),
    },
    "spelling_correction": {
        "name": "Spelling Correction",
        "description": "Fix only spelling errors and character misrecognitions",
        "prompt": (
            "You are a spelling correction assistant for OCR output of "
            "historical Spanish documents. Fix ONLY spelling errors and "
            "character misrecognitions. Do not change wording, do not "
            "translate or modernise, do not add or remove content."
        ),
    },
    "formatting": {
        "name": "Format & Structure",
        "description": "Normalize spacing within lines (line count stays fixed)",
        "prompt": (
            "You are a text formatting assistant for OCR output.\n"
            "- Normalize spacing within each line (remove extra spaces, fix missing spaces)\n"
            "- Do NOT change any words or fix spelling\n"
            "- Do NOT add or remove content"
        ),
    },
    "historical_normalization": {
        "name": "Historical Text Normalization",
        "description": "Normalize archaic spellings and historical typography",
        "prompt": (
            "You are a historical text normalization assistant.\n"
            "- Normalize long-s (ſ) to modern 's'\n"
            "- Expand common ligatures (ﬀ→ff, ﬁ→fi, ﬂ→fl, ﬃ→ffi, ﬄ→ffl)\n"
            "- Normalize archaic letter forms while preserving meaning\n"
            "- Fix OCR errors specific to historical typefaces\n"
            "- Do NOT modernise vocabulary or grammar"
        ),
    },
}


def get_template(name: str) -> str:
    """Return the prompt prefix for the given template + the line contract.

    The whole-page transcript is concatenated straight after the returned
    string by the provider clients, so the line-preservation contract and the
    input header live at the very end here.
    """
    entry = TEMPLATES.get(name, TEMPLATES["full_cleanup"])
    return entry["prompt"] + _LINE_PRESERVATION


def list_templates() -> list:
    """Return a list of available template metadata."""
    return [
        {"id": key, "name": val["name"], "description": val["description"]}
        for key, val in TEMPLATES.items()
    ]
