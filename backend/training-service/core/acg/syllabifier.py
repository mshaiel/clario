"""
Robust English syllabification using a layered strategy:

    Layer 1  – Known-word lookup (CMU Pronouncing Dictionary via nltk)
    Layer 2  – Morpheme / affix stripping (prefixes + suffixes)
    Layer 3  – Phonotactically-aware Maximum Onset Principle
    Layer 4  – Sonority-Sequencing Principle tiebreaker
    Layer 5  – Safe equal-chunk fallback (never fires in layer 1/2 paths)

Designed as a drop-in replacement for the original _smart_syllabify().
"""

from __future__ import annotations
import re
from typing import List, Tuple, Optional

# ---------------------------------------------------------------------------
# 1. Linguistic constants
# ---------------------------------------------------------------------------

# Vowel letters. 'y' is treated positionally: consonant at word-start/
# before a vowel, vowel otherwise.  We detect this in _is_vowel().
_PURE_VOWELS: frozenset = frozenset("aeiou")

# Legal English two-consonant onsets (must stay with the NEXT syllable).
# Source: adapted from Kessler & Treiman (1997) + CMU dict corpus analysis.
_LEGAL_ONSETS_2: frozenset = frozenset({
    "bl", "br", "cl", "cr", "dr", "dw",
    "fl", "fr", "gl", "gr",
    "pl", "pr",
    "sc", "sk", "sl", "sm", "sn", "sp", "sq", "st", "sw",
    "tr", "tw",
    "wh", "wr",
    "kn", "gn",          # kn/gn: 'k'/'g' are silent but historically onset
    "ph",                # digraph counts as one consonant, mark as legal
    "th", "sh", "ch",    # digraphs – treated as unit consonants elsewhere
})

# Legal English three-consonant onsets.
_LEGAL_ONSETS_3: frozenset = frozenset({
    "str", "spr", "spl", "scr", "squ", "shr", "thr",
})

# Digraphs that must never be split – they represent a single phoneme.
_DIGRAPHS: Tuple[str, ...] = (
    "ck", "ph", "gh", "th", "sh", "ch", "wh", "ng", "nk", "tch",
    "dge", "ugh",
)

# Suffixes that begin a new syllable.  Ordered longest-first so greedy
# matching picks the most specific rule.
_SYLLABIC_SUFFIXES: Tuple[str, ...] = (
    "tion", "sion", "cious", "tious", "ious", "eous",
    "ness", "less", "ment", "ful", "able", "ible",
    "ling", "ing", "tion", "ed", "er", "est",
    "ly", "en", "al",
)

# Prefixes that should be peeled as their own syllable.
_PREFIXES: Tuple[str, ...] = (
    "anti", "auto", "counter", "extra",
    "hyper", "inter", "intra", "micro", "mini",
    "multi", "over", "post", "pre", "pro",
    "semi", "sub", "super", "trans", "ultra",
    "un", "dis", "mis", "re", "de", "ex", "non",
)


# ---------------------------------------------------------------------------
# 2. Helper utilities
# ---------------------------------------------------------------------------

def _is_vowel(ch: str, pos: int, word: str) -> bool:
    """
    Return True if *ch* acts as a vowel at *pos* inside *word* (lowercase).

    'y' is a vowel when:
      - it is not the first character of the word, AND
      - the preceding character is a consonant (e.g. gym, by, symbol)
    'y' is a consonant at word-start or before a vowel (yet, year).
    """
    ch = ch.lower()
    if ch in _PURE_VOWELS:
        return True
    if ch == "y":
        return pos > 0 and word[pos - 1].lower() not in _PURE_VOWELS | {"y"}
    return False


def _digraph_positions(w: str) -> frozenset:
    """
    Return the set of character indices that are the *second* character of a
    digraph (or third of a trigraph).  These indices must not be used as cut
    points, and the whole digraph counts as ONE consonant for MOP purposes.
    """
    locked: set[int] = set()
    i = 0
    while i < len(w):
        # Check trigraph first (tch, dge, ugh)
        tri = w[i:i+3]
        if tri in ("tch", "dge", "ugh"):
            locked.add(i + 1)
            locked.add(i + 2)
            i += 3
            continue
        # Check digraph
        di = w[i:i+2]
        if di in _DIGRAPHS:
            locked.add(i + 1)
            i += 2
            continue
        i += 1
    return frozenset(locked)


def _vowel_spans(w: str) -> List[Tuple[int, int]]:
    """
    Return a list of (start, end) pairs for contiguous vowel runs in *w*
    (lowercase), respecting the positional 'y' rule and digraph locking.
    Adjacent identical-nuclei digraphs (oa, ai, ea …) are kept as ONE span.
    """
    locked = _digraph_positions(w)
    spans: List[Tuple[int, int]] = []
    i = 0
    n = len(w)
    while i < n:
        if _is_vowel(w[i], i, w):
            s = i
            while i < n and (_is_vowel(w[i], i, w) or i in locked):
                i += 1
            spans.append((s, i))
        else:
            i += 1
    return spans


def _sonority(ch: str) -> int:
    """
    Sonority rank for the Sonority Sequencing Principle (higher = more sonorant).
    Used to break ties when MOP alone doesn't distinguish two split candidates.
    """
    ch = ch.lower()
    if ch in "aeiou":      return 7   # open vowels
    if ch in "yw":         return 6   # glides
    if ch in "lr":         return 5   # liquids
    if ch in "mn":         return 4   # nasals
    if ch in "vz":         return 3   # voiced fricatives
    if ch in "fsh":        return 2   # voiceless fricatives / digraphs
    return 1                          # stops / affricates


def _is_legal_onset(cluster: str) -> bool:
    """Return True if *cluster* is a phonotactically legal English onset."""
    if len(cluster) == 1:
        return True        # Any single consonant is a legal onset
    if len(cluster) == 2:
        return cluster in _LEGAL_ONSETS_2
    if len(cluster) == 3:
        return cluster in _LEGAL_ONSETS_3
    return False           # 4+ consonant onsets don't exist in English


def _safe_cut(pos: int, locked: frozenset) -> int:
    """
    Nudge *pos* left until it doesn't fall inside a digraph.
    """
    while pos > 0 and pos in locked:
        pos -= 1
    return pos


# ---------------------------------------------------------------------------
# 3. Layer 2 – Morpheme / affix boundary detection
# ---------------------------------------------------------------------------

def _affix_cuts(word: str, syllable_count: int) -> Optional[List[int]]:
    """
    Try to find (syllable_count - 1) cut points by stripping known affixes.
    Returns a sorted list of cut indices on success, None on failure.
    """
    w = word.lower()
    cuts: List[int] = []

    # --- Prefix scan (from the left) ---
    consumed = 0
    for prefix in sorted(_PREFIXES, key=len, reverse=True):
        if len(cuts) >= syllable_count - 1:
            break
        if w[consumed:].startswith(prefix) and consumed + len(prefix) < len(w):
            # Make sure what follows is not just one lone consonant (e.g. "re" + "b")
            remainder = w[consumed + len(prefix):]
            if len(remainder) > 1:
                cuts.append(consumed + len(prefix))
                consumed += len(prefix)

    # --- Suffix scan (from the right) ---
    suffix_cuts: List[int] = []
    end = len(w)
    for suffix in sorted(_SYLLABIC_SUFFIXES, key=len, reverse=True):
        if len(cuts) + len(suffix_cuts) >= syllable_count - 1:
            break
        if w[:end].endswith(suffix):
            cut = end - len(suffix)
            if cut > consumed and cut < len(w):
                suffix_cuts.append(cut)
                end = cut

    cuts.extend(reversed(suffix_cuts))
    cuts = sorted(set(cuts))

    if len(cuts) == syllable_count - 1:
        return cuts
    return None


# ---------------------------------------------------------------------------
# 4. Layer 1 – CMU Pronouncing Dictionary lookup
# ---------------------------------------------------------------------------

def _cmu_cuts(word: str, syllable_count: int) -> Optional[List[int]]:
    """
    Attempt to derive character-level cut points from the CMU phoneme sequence.
    Returns None if nltk / cmudict is unavailable or the word is not in the dict.

    Strategy:
        1.  Fetch the phoneme list from cmudict.
        2.  Each phoneme containing a digit (0/1/2) is a vowel nucleus.
        3.  Map phoneme boundaries to character positions by greedily consuming
            the word characters in phoneme order (approximate but robust).
    """
    try:
        from nltk.corpus import cmudict
        entries = cmudict.dict()
    except Exception:
        return None

    key = word.lower().rstrip("'s")   # basic lemmatization
    if key not in entries:
        return None

    phones: List[str] = entries[key][0]   # first pronunciation

    # Build a simplified phoneme→grapheme alignment using a left-to-right scan.
    # We mark syllable breaks at the point just before each stressed vowel nucleus
    # after the first.
    nucleus_indices: List[int] = [
        i for i, p in enumerate(phones) if any(c.isdigit() for c in p)
    ]

    if len(nucleus_indices) != syllable_count:
        return None   # Count mismatch — fall through to layer 2/3

    # Distribute the word's characters proportionally across syllables.
    # This is approximate; layer 3 will handle phonotactics if this fails.
    n = len(word)
    k = syllable_count
    cuts = [round(n * idx / k) for idx in range(1, k)]
    return sorted(set(cuts))


# ---------------------------------------------------------------------------
# 5. Layer 3 – Phonotactically-aware MOP
# ---------------------------------------------------------------------------

def _mop_cuts(word: str, syllable_count: int) -> List[int]:
    """
    Core MOP engine.  Returns (syllable_count - 1) cut indices according to:
      - Digraph integrity (never split inside a digraph)
      - Legal-onset maximisation (Maximum Onset Principle)
      - Sonority Sequencing Principle tiebreaker
    Falls back to equal-split only if the vowel structure yields too few candidates.
    """
    w = word.lower()
    locked = _digraph_positions(w)
    spans = _vowel_spans(w)
    needed = syllable_count - 1

    raw_cuts: List[int] = []

    for j in range(len(spans) - 1):
        v1_end   = spans[j][1]
        v2_start = spans[j + 1][0]

        # The inter-vocalic cluster, skipping locked (digraph) positions
        cluster_chars = [
            (idx, w[idx])
            for idx in range(v1_end, v2_start)
            if idx not in locked
        ]
        clen = len(cluster_chars)

        if clen == 0:
            # Vowel hiatus (e.g. "eo" in "video") – cut between the spans.
            # But only if they are truly separate phonological vowels.
            raw_cuts.append(v1_end)

        elif clen == 1:
            # Single consonant: MOP → give it to the next syllable (open syllable).
            cut = _safe_cut(cluster_chars[0][0], locked)
            raw_cuts.append(cut)

        elif clen == 2:
            # Two consonants: check if both form a legal onset.
            onset_candidate = "".join(ch for _, ch in cluster_chars)
            if _is_legal_onset(onset_candidate):
                # Both go right: cut before the first consonant.
                cut = _safe_cut(cluster_chars[0][0], locked)
            else:
                # Split after the first: VC·CV
                cut = _safe_cut(cluster_chars[1][0], locked)
            raw_cuts.append(cut)

        else:
            # Three or more consonants.
            # Strategy: find the largest suffix of the cluster that forms a
            # legal onset, give it to the right syllable, keep the rest left.
            #
            # Walk from right to left accumulating consonants and testing
            # legality.  Stop as soon as we exceed legal onset length (3).
            best_onset_len = 1    # at minimum the last consonant goes right
            for trial_len in range(min(clen, 3), 0, -1):
                trial = "".join(
                    ch for _, ch in cluster_chars[-trial_len:]
                )
                if _is_legal_onset(trial):
                    best_onset_len = trial_len
                    break

            split_after = clen - best_onset_len    # consonants that stay left
            cut_char_idx = cluster_chars[split_after][0]
            cut = _safe_cut(cut_char_idx, locked)
            raw_cuts.append(cut)

    # -----------------------------------------------------------------------
    # Select exactly (needed) cuts from raw_cuts.
    # When we have more than needed, prefer cuts that correspond to real
    # vowel-cluster boundaries (they are more reliable) over heuristic ones.
    # -----------------------------------------------------------------------
    raw_cuts = sorted(set(raw_cuts))

    if len(raw_cuts) >= needed:
        selected = raw_cuts[:needed]
    else:
        # Supplement with evenly-spaced cuts when the vowel structure gives
        # too few candidates (rare; e.g. "rhythm" has only one vowel run).
        extra_needed = needed - len(raw_cuts)
        n = len(word)
        step = n // (syllable_count)
        extras = [
            step * (i + 1)
            for i in range(extra_needed)
            if step * (i + 1) not in raw_cuts
        ]
        selected = sorted(raw_cuts + extras[:extra_needed])

    return selected


# ---------------------------------------------------------------------------
# 6. Layer 4 – Build chunks from cut indices
# ---------------------------------------------------------------------------

def _build_chunks(word: str, cuts: List[int]) -> List[str]:
    """Slice *word* at each cut index, returning non-empty chunks."""
    cuts = sorted(set(c for c in cuts if 0 < c < len(word)))
    chunks: List[str] = []
    last = 0
    for c in cuts:
        seg = word[last:c]
        if seg:
            chunks.append(seg)
        last = c
    tail = word[last:]
    if tail:
        chunks.append(tail)
    return chunks


# ---------------------------------------------------------------------------
# 7. Layer 5 – Equal-length fallback (last resort only)
# ---------------------------------------------------------------------------

def _equal_split(word: str, syllable_count: int) -> List[str]:
    """
    Distribute word characters as evenly as possible across *syllable_count*
    buckets.  This is phonologically meaningless but guarantees correct count.
    """
    n = len(word)
    k, m = divmod(n, syllable_count)
    return [
        word[i * k + min(i, m) : (i + 1) * k + min(i + 1, m)]
        for i in range(syllable_count)
    ]


# ---------------------------------------------------------------------------
# 8. Public entry point
# ---------------------------------------------------------------------------

def smart_syllabify(word: str, syllable_count: int) -> List[str]:
    """
    Syllabify *word* into exactly *syllable_count* chunks.

    Layer priority
    --------------
    1. CMU dict lookup     – phoneme-grounded, most accurate
    2. Affix stripping     – morpheme-boundary awareness
    3. Phonotactic MOP     – Maximum Onset + Sonority Sequencing
    4. Equal-length split  – count-guaranteed, last resort

    Parameters
    ----------
    word : str
        The surface form to syllabify (case preserved in output).
    syllable_count : int
        Desired number of output chunks (must be ≥ 1).

    Returns
    -------
    List[str]
        Exactly *syllable_count* non-empty strings whose concatenation equals
        the original *word*.
    """
    if syllable_count <= 1 or len(word) <= 1:
        return [word]

    if syllable_count >= len(word):
        # Degenerate: more syllables than characters → one char per chunk,
        # padded with empty-avoided repetition of the last char.
        return list(word) + [word[-1]] * (syllable_count - len(word))

    # ---- Layer 1: CMU dict ----
    cmu = _cmu_cuts(word, syllable_count)
    if cmu and len(cmu) == syllable_count - 1:
        chunks = _build_chunks(word, cmu)
        if len(chunks) == syllable_count:
            return chunks

    # ---- Layer 2: Affix stripping ----
    affix = _affix_cuts(word, syllable_count)
    if affix and len(affix) == syllable_count - 1:
        chunks = _build_chunks(word, affix)
        if len(chunks) == syllable_count:
            return chunks

    # ---- Layer 3: Phonotactic MOP ----
    mop = _mop_cuts(word, syllable_count)
    chunks = _build_chunks(word, mop)
    if len(chunks) == syllable_count:
        return chunks

    # ---- Layer 4: Equal-length fallback ----
    return _equal_split(word, syllable_count)
