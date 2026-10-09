"""Full-page test set: scanned pages with their scholars' transcriptions.

Pages come only from books no model was trained on (the corpus validation books
plus PORCONES.23.5, which is not in the corpus), so page-level CER/WER is a fair
end-to-end measure of preprocessing + detection + recognition.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import fitz
from PIL import Image

from .corpus import normalize
from .paths import DATA

PDFS, TRANSCRIPTS, PAGES = DATA / "pdfs", DATA / "transcripts", DATA / "pages"
SPREAD_RATIO = 1.19  # wider than this = two facing pages; the app splits them the same way

# book -> (pdf, transcript folder). Buendía and PORCONES name pages like the PDF
# ("page3_left"); Padilla's numbering is its own and is matched by text (below).
TEST_BOOKS = {
    "Buendia - Instruccion": ("Buendia - Instruccion.pdf", "Buendia - Instruccion transcription"),
    "PORCONES.23.5 - 1628": ("PORCONES.23.5 - 1628.pdf", "PORCONES.23.5 - 1628 transcription"),
    "Padilla - Nobleza virtuosa": ("Padilla - 1 Nobleza virtuosa (1637).pdf", "Padilla - 1 Nobleza virtuosa (1637)"),
}


@dataclass
class Page:
    book: str
    name: str
    image: Path
    text: str  # ground truth, whitespace-normalized

    @property
    def lines(self) -> list[str]:
        return [normalize(l) for l in self.image.with_suffix(".txt").read_text(encoding="utf-8").splitlines()
                if l.strip()]


class PdfBook:
    """A scanned PDF rendered at its native scan resolution, spreads split in two."""

    def __init__(self, pdf: Path):
        self.doc = fitz.open(pdf)

    def render(self, number: int) -> dict[str, Image.Image]:
        """{"page7": img} or {"page7_left": img, "page7_right": img} (1-based page number)."""
        page = self.doc[number - 1]
        scan = page.get_images()
        scale = fitz.Pixmap(self.doc, scan[0][0]).width / page.rect.width if scan else 2.0
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        if img.width <= img.height * SPREAD_RATIO:
            return {f"page{number}": img}
        half = img.width // 2
        return {f"page{number}_left": img.crop((0, 0, half, img.height)),
                f"page{number}_right": img.crop((half, 0, img.width, img.height))}

    def embedded_text(self, number: int) -> dict[str, str]:
        """The PDF's own (rough) OCR text layer, split the same way as render()."""
        page = self.doc[number - 1]
        words = page.get_text("words")
        if page.rect.width <= page.rect.height * SPREAD_RATIO:
            return {f"page{number}": " ".join(w[4] for w in words)}
        mid = page.rect.width / 2
        return {f"page{number}_left": " ".join(w[4] for w in words if (w[0] + w[2]) / 2 < mid),
                f"page{number}_right": " ".join(w[4] for w in words if (w[0] + w[2]) / 2 >= mid)}


def _trigrams(text: str) -> set[str]:
    # Old OCR reads the long s as "f"; fold both to compare with modern transcriptions.
    t = re.sub(r"[^a-zñ]+", " ", text.lower().replace("f", "s").replace("ſ", "s"))
    return {t[i:i + 3] for i in range(len(t) - 2)}


def match_transcripts(book: PdfBook, transcripts: dict[str, str], min_score: float = 0.7) -> dict[str, str]:
    """Pair each transcript with the PDF half-page whose text layer covers most of its trigrams."""
    layer = {}
    for n in range(1, len(book.doc) + 1):
        layer.update({name: _trigrams(t) for name, t in book.embedded_text(n).items()})
    matches = {}
    for tname, text in transcripts.items():
        grams = _trigrams(text)
        if not grams:
            continue
        best = max(layer, key=lambda name: len(grams & layer[name]))
        if len(grams & layer[best]) / len(grams) >= min_score:
            matches[tname] = best
    return matches


def build_test_pages() -> list[Page]:
    """Render every transcribed page of the test books into data/pages/ (cached)."""
    pages = []
    for book, (pdf, folder) in TEST_BOOKS.items():
        transcripts = {f.stem: f.read_text(encoding="utf-8-sig") for f in sorted((TRANSCRIPTS / folder).glob("*.txt"))}
        transcripts = {k: v for k, v in transcripts.items() if v.strip()}
        pdf_book = PdfBook(PDFS / pdf)
        names = match_transcripts(pdf_book, transcripts) if book.startswith("Padilla") else \
            {k: k for k in transcripts}
        out = PAGES / book
        out.mkdir(parents=True, exist_ok=True)
        for tname, pname in sorted(names.items()):
            image = out / f"{pname}.png"
            if not image.exists():
                number = int(re.match(r"page(\d+)", pname).group(1))
                pdf_book.render(number)[pname].save(image)
                image.with_suffix(".txt").write_text(transcripts[tname], encoding="utf-8")
            pages.append(Page(book, pname, image, normalize(transcripts[tname])))
    return pages
