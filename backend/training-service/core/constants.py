"""
core/constants.py — Shared linguistic constants used across triage, tensor_bridge,
and ACG. Single source of truth: edit here, everywhere benefits.
"""
from typing import Dict, List, Set

# ── Phoneme Inventory (64 symbols, V7 interleaved order) ──────────────────────
PHONEMES: List[str] = [
    # Stops
    'p', 'pʰ', 'b', 'bʰ', 't', 'tʰ', 'd', 'dʰ',
    't̪', 't̪ʰ', 'd̪', 'd̪ʱ', 'ʈ', 'ɖ',
    'k', 'kʰ', 'g', 'ɡʰ', 'q', 'ʔ',
    # Fricatives
    'f', 'v', 's', 'z', 'ʃ', 'ʒ', 'ʂ', 'ʐ', 'x', 'ɣ', 'h', 'θ', 'ð',
    # Affricates
    'tʃ', 'dʒ',
    # Nasals
    'm', 'mʰ', 'n', 'nʰ', 'ŋ', 'ɳ',
    # Liquids
    'l', 'lʰ', 'r', 'rʰ', 'ɽ', 'ɽʰ',
    # Glides
    'w', 'j',
    # Vowels
    'a', 'aː', 'i', 'iː', 'u', 'uː', 'e', 'eː', 'o', 'oː', 'ə', 'æ', 'ɔ', 'ɪ', 'ʊ',
]

P2I: Dict[str, int] = {p: i for i, p in enumerate(PHONEMES)}

# ── Error Types (9 columns, aligned with training data) ───────────────────────
ERRORS: List[str] = [
    "Substitution",       # 0
    "Velar Fronting",     # 1
    "Stopping",           # 2
    "Gliding",            # 3
    "Cluster Reduction",  # 4
    "Epenthesis",         # 5
    "Blocks",             # 6
    "Prolongation",       # 7
    "Repetition",         # 8
]

ERROR_MAP: Dict[str, int] = {
    "sub": 0, "substitution": 0,
    "front": 1, "fronting": 1, "velar fronting": 1,
    "stop": 2, "stopping": 2,
    "glide": 3, "gliding": 3,
    "clust": 4, "cluster": 4, "cluster reduction": 4,
    "epen": 5, "epenthesis": 5,
    "block": 6, "blocking": 6, "blocks": 6,
    "prolong": 7, "prolongation": 7,
    "repeat": 8, "repetition": 8,
}

# ── Major Type Mapping ─────────────────────────────────────────────────────────
# error_idx → major category name
MAJOR_MAP: Dict[int, str] = {
    0: "Artic", 1: "Artic", 2: "Artic", 3: "Artic", 4: "Artic",
    5: "Motor",
    6: "Fluency", 7: "Fluency", 8: "Fluency",
}

# major name → AEG integer index (matches training: ["Artic", "Fluency", "Motor"])
MAJOR_NAME_TO_IDX: Dict[str, int] = {"Artic": 0, "Fluency": 1, "Motor": 2}

# Clinical priority for triage sort (higher = treated first)
PRIORITY: Dict[str, int] = {"Motor": 3, "Fluency": 2, "Artic": 1}

# ── Language Masks ─────────────────────────────────────────────────────────────
# English: standard IPA consonants + merged vowels; excludes aspirates, retroflexes, uvulars
ENGLISH_MASK: Set[str] = {
    'p', 'b', 't', 'd', 'k', 'g',
    'f', 'v', 's', 'z', 'ʃ', 'ʒ', 'h', 'θ', 'ð', 'tʃ', 'dʒ',
    'm', 'n', 'ŋ', 'l', 'r', 'w', 'j',
    'a', 'e', 'i', 'o', 'u', 'æ', 'ɔ', 'ɪ', 'ʊ', 'ə',
    'aː', 'iː', 'uː', 'eː', 'oː',
}

# Urdu: full Pakistani IPA inventory; excludes English-only θ, ð, æ
URDU_MASK: Set[str] = {
    'p', 'pʰ', 'b', 'bʰ', 't', 'tʰ', 'd', 'dʰ',
    't̪', 't̪ʰ', 'd̪', 'd̪ʱ', 'ʈ', 'ɖ',
    'k', 'kʰ', 'g', 'ɡʰ', 'q', 'ʔ',
    'f', 'v', 's', 'z', 'ʃ', 'ʒ', 'ʂ', 'ʐ', 'x', 'ɣ', 'h',
    'tʃ', 'dʒ',
    'm', 'mʰ', 'n', 'nʰ', 'ŋ', 'ɳ',
    'l', 'lʰ', 'r', 'rʰ', 'ɽ', 'ɽʰ',
    'w', 'j',
    'a', 'aː', 'i', 'iː', 'u', 'uː', 'e', 'eː', 'o', 'oː', 'ə', 'ɔ', 'ɪ', 'ʊ',
}

LANGUAGE_MASKS: Dict[str, Set[str]] = {
    "english": ENGLISH_MASK,
    "urdu":    URDU_MASK,
}
