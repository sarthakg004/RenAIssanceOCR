"""
Shared OCR Prompt — used by all providers.
This text must remain IDENTICAL to the original.
"""

# OCR_PROMPT = """
#     You are performing high-accuracy OCR transcription.

#     Transcribe ALL readable text exactly as it appears in the image.

#     Core rules:

#     * Preserve original line breaks.
#     * Preserve paragraph spacing.
#     * Preserve punctuation and special characters.
#     * Preserve original spelling (do NOT modernize).
#     * Preserve capitalization exactly.
#     * Keep hyphenated line-break words exactly as shown.
#     * Do NOT summarize.
#     * Do NOT explain.
#     * Output only the transcription.

#     Layout rules:

#     * If text is in multiple columns, transcribe column by column from left to right.
#     * Preserve indentation if visible.
#     * Keep headings and section breaks.
#     * Keep marginal notes or side text on separate lines and prefix them with "[margin] ".

#     Context-based reconstruction rules:

#     * If a word is partially unclear, use surrounding letters and sentence context to infer the most likely word.
#     * Prefer historically and linguistically plausible words over random guesses.
#     * Use your language knowledge to reconstruct faded or broken characters when confidence is reasonably high.
#     * Do NOT mark a word as illegible if a strong contextual reconstruction is possible.

#     Uncertainty handling:

#     * If reconstruction is reasonably confident → output the reconstructed word normally.
#     * If multiple interpretations are possible → choose the most contextually likely one.
#     * If text is truly unreadable with no strong contextual clue → use [illegible].
#     * If only one or two characters are unclear but the word is inferable → output the full inferred word.

#     Noise handling:

#     * Ignore page borders, stains, ornaments, and decorative lines.
#     * Do not include printer marks unless they are clearly text.
# """

OCR_PROMPT = """
---

You are performing **high-precision historical OCR transcription**.

Your task is to transcribe **only the main body text** of the page with maximum fidelity and zero commentary.

---

### PRIMARY OBJECTIVE

Produce a clean diplomatic transcription of the main content exactly as printed, with standardized long-ſ normalization.

---

### TRANSCRIPTION RULES

1. Preserve original line breaks exactly.
2. Preserve paragraph spacing exactly.
3. Preserve original spelling (do NOT modernize or normalize spelling).
4. Preserve capitalization exactly as shown.
5. Preserve punctuation and special characters exactly.
6. Convert the long-ſ (ſ) to a standard "s" in all cases.
7. Preserve ligatures as standard character equivalents:

   * “ﬀ” → “ff”
   * “ﬁ” → “fi”
   * “ﬂ” → “fl”
   * “ﬃ” → “ffi”
   * “ﬄ” → “ffl”
8. Preserve hyphenated line-break words exactly as printed.
9. Do NOT merge, reflow, or restructure lines.
10. Do NOT summarize.
11. Do NOT explain.
12. Output only the transcription text.

---

### LAYOUT RULES

* If the page has multiple columns, transcribe column-by-column from left to right.
* Preserve visible indentation.
* Preserve headings and section titles as plain text.
* Maintain original line structure even if it breaks mid-sentence.

---

### CONTENT FILTERING RULES

Include:

* Main body text
* Headings and subheadings
* Page numbers only if embedded within the body text flow

Exclude completely (without marking omission):

* Marginal notes
* Side notes
* Running headers
* Running footers
* Catchwords
* Page signatures
* Printer marks
* Decorative elements
* Stamps
* Handwritten annotations

Do NOT indicate omissions. Simply ignore excluded material.

---

### RECONSTRUCTION RULES

* If a word is partially faded but context makes reconstruction highly probable, output the reconstructed word normally.
* Prefer historically and linguistically plausible reconstructions.
* If multiple interpretations are possible, choose the most contextually probable one.
* If text cannot be reconstructed with high confidence, omit that word silently rather than inserting markers.

Never insert:

* Brackets of any kind
* Uncertainty markers
* Editorial comments
* Added punctuation not present in the original

---

### OUTPUT REQUIREMENTS

* Output only the transcription.
* No metadata.
* No explanations.
* No uncertainty markers.
* No additional formatting beyond faithful line preservation.

The output must be clean, normalized (ſ → s), and suitable for direct OCR training use.

"""