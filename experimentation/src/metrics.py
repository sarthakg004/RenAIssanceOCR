"""Character and word error rates, summed over a corpus (micro-averaged)."""

from rapidfuzz.distance import Levenshtein


def cer(predictions: list[str], references: list[str]) -> float:
    """Character edits needed to turn the predictions into the references, per reference character."""
    edits = sum(Levenshtein.distance(p, r) for p, r in zip(predictions, references))
    return edits / max(1, sum(len(r) for r in references))


def wer(predictions: list[str], references: list[str]) -> float:
    """The same, counted in whitespace-separated words."""
    edits = sum(Levenshtein.distance(p.split(), r.split()) for p, r in zip(predictions, references))
    return edits / max(1, sum(len(r.split()) for r in references))
