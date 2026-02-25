"""
Shared OCR Prompt — used by all providers.
This text must remain IDENTICAL to the original.
"""

OCR_PROMPT = """
    You are performing high-accuracy OCR transcription.

    Transcribe ALL readable text exactly as it appears in the image.

    Core rules:

    * Preserve original line breaks.
    * Preserve paragraph spacing.
    * Preserve punctuation and special characters.
    * Preserve original spelling (do NOT modernize).
    * Preserve capitalization exactly.
    * Keep hyphenated line-break words exactly as shown.
    * Do NOT summarize.
    * Do NOT explain.
    * Output only the transcription.

    Layout rules:

    * If text is in multiple columns, transcribe column by column from left to right.
    * Preserve indentation if visible.
    * Keep headings and section breaks.
    * Keep marginal notes or side text on separate lines and prefix them with "[margin] ".

    Context-based reconstruction rules:

    * If a word is partially unclear, use surrounding letters and sentence context to infer the most likely word.
    * Prefer historically and linguistically plausible words over random guesses.
    * Use your language knowledge to reconstruct faded or broken characters when confidence is reasonably high.
    * Do NOT mark a word as illegible if a strong contextual reconstruction is possible.

    Uncertainty handling:

    * If reconstruction is reasonably confident → output the reconstructed word normally.
    * If multiple interpretations are possible → choose the most contextually likely one.
    * If text is truly unreadable with no strong contextual clue → use [illegible].
    * If only one or two characters are unclear but the word is inferable → output the full inferred word.

    Noise handling:

    * Ignore page borders, stains, ornaments, and decorative lines.
    * Do not include printer marks unless they are clearly text.
"""
