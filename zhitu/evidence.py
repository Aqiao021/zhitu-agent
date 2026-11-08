"""Locate a model-quoted "evidence" sentence inside the resume, tolerating small copy differences.

Models often change full-width punctuation to half-width, drop a comma or a trailing period, or
miss a character when they quote. Exact matching rejected those quotes as "fabricated". Here we
compare a canonical form (NFKC, lower case, letters and digits only); if that is not an exact
substring, an approximate substring search (Sellers' edit distance) accepts quotes that are at
least SIMILARITY similar. The returned span always points at the resume's own text, so what the
user sees as evidence is a real quote even when the model's copy was slightly off.

Keep in sync with locateEvidence() in web/browser-client.js.
"""
import unicodedata

SIMILARITY = 0.85
MIN_FUZZY = 8  # shorter quotes must match exactly (after canonicalisation)


def canon(text: str) -> tuple[str, list[int]]:
    """Canonical string plus, for each canonical char, its index in the original text."""
    out, idx = [], []
    for i, ch in enumerate(text or ""):
        for c in unicodedata.normalize("NFKC", ch).lower():
            if unicodedata.category(c)[0] in "LN":
                out.append(c)
                idx.append(i)
    return "".join(out), idx


def _sellers(pattern: str, text: str) -> tuple[int, int, int]:
    """Best approximate occurrence of pattern in text: (distance, start, end) in text indices."""
    m = len(pattern)
    prev = [0] * (len(text) + 1)          # row 0: free start anywhere
    start = list(range(len(text) + 1))
    for i in range(1, m + 1):
        cur, cur_start = [i] + [0] * len(text), [0] + [0] * len(text)
        pc = pattern[i - 1]
        for j in range(1, len(text) + 1):
            best, s = prev[j - 1] + (pc != text[j - 1]), start[j - 1]
            if prev[j] + 1 < best:
                best, s = prev[j] + 1, start[j]
            if cur[j - 1] + 1 < best:
                best, s = cur[j - 1] + 1, cur_start[j - 1]
            cur[j], cur_start[j] = best, s
        prev, start = cur, cur_start
    end = min(range(len(text) + 1), key=lambda j: (prev[j], j))
    return prev[end], start[end], end


def locate(evidence: str, resume: str) -> dict | None:
    """Return {"text", "exact", "similarity"} for the matching resume passage, or None."""
    ev, _ = canon(evidence)
    if not ev:
        return None
    res, idx = canon(resume)
    pos = res.find(ev)
    if pos >= 0:
        a, b = idx[pos], idx[pos + len(ev) - 1] + 1
        return {"text": resume[a:b], "exact": True, "similarity": 1.0}
    m = len(ev)
    if m < MIN_FUZZY or not res:
        return None
    # candidate windows: around resume positions sharing a 3-gram with the quote
    grams = {ev[i:i + 3] for i in range(m - 2)}
    hits = [j for j in range(len(res) - 2) if res[j:j + 3] in grams]
    windows: list[list[int]] = []
    for j in hits:
        if windows and j - windows[-1][1] <= m:
            windows[-1][1] = j
        else:
            windows.append([j, j])
    best = None
    for lo, hi in sorted(windows, key=lambda w: w[0] - w[1])[:6]:
        a0, b0 = max(0, lo - m), min(len(res), hi + m + 3)
        dist, s, e = _sellers(ev, res[a0:b0])
        sim = 1 - dist / m
        if e > s and (best is None or sim > best[0]):
            best = (sim, a0 + s, a0 + e)
    if not best or best[0] < SIMILARITY:
        return None
    sim, s, e = best
    a, b = idx[s], idx[e - 1] + 1
    return {"text": resume[a:b], "exact": False, "similarity": round(sim, 3)}
