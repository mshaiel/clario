"""
config.py — Central configuration for Clario Training Module.
All tuneable runtime values live here. No logic, no imports.
"""

# ── Runtime ───────────────────────────────────────────────────────────────────
DEVICE = "cpu"           # Switch to "cuda" for GPU inference
VERSION = "2.4.0"

# ── Model Paths ───────────────────────────────────────────────────────────────
AMLM_PATH = "models/amlm_v5.pth"
AEG_PATH  = "models/aeg_v5.pth"

# ── AMLM Architecture ─────────────────────────────────────────────────────────
AMLM_LATENT_DIM     = 64
AMLM_INPUT_CHANNELS = 6    # 3 value + 3 visibility
AMLM_OUT_CHANNELS   = 3    # Initial / Medial / Final
AMLM_NUM_PHONEMES   = 64
AMLM_NUM_ERRORS     = 9

# ── AEG Architecture ──────────────────────────────────────────────────────────
AEG_NUM_PHONEMES   = 64
AEG_NUM_ERRORS     = 9
AEG_NUM_MAJOR      = 3
AEG_NUM_POSITIONS  = 3
AEG_NUM_STRUCTURES = 8
AEG_MAX_SEQ_LEN    = 10
AEG_HIDDEN_SIZE    = 128

# ── Triage ────────────────────────────────────────────────────────────────────
TRIAGE_THRESHOLD = 0.6    # Minimum score to flag a clinical pattern

# ── AEG Output Decoding ───────────────────────────────────────────────────────
AEG_MIN_VOLUME        = 3
AEG_MAX_VOLUME        = 10
AEG_FORBIDDEN_TOPK    = 3   # How many trap phonemes Head C nominates

FORMAT_MAP = [
    "Auditory_Bombardment",
    "Phoneme_Isolation",
    "Minimal_Pairs",
    "Syllable_Chaining",
    "Carrier_Phrases",
    "Pacing",
    "Shadowing",
    "Speed_Drills",
]

STRUCTURE_MAP = ["CV", "VC", "CVC", "VCV", "CVCV", "CCV", "VCC", "Complex"]

# ── ACG Item Targets ─────────────────────────────────────────────────────────
DEFAULT_FORMAT_ITEM_COUNT = 8
FORMAT_ITEM_COUNTS = {
    "Auditory_Bombardment": 8,
    "Phoneme_Isolation": 8,
    "Minimal_Pairs": 8,
    "Syllable_Chaining": 6,
    "Carrier_Phrases": 8,
    "Pacing": 8,
    "Shadowing": 5,
    "Speed_Drills": 8,
    "Sentences": 6,
}

# ── ACG / Lexicon ─────────────────────────────────────────────────────────────
# Map AEG difficulty levels (1-5) to DB ranges: (min_diff, max_diff, min_freq)
# Note: clario.db has difficulty values in range [0.20, 1.0]; all freq values
# are 1 (freq data was not populated), so min_freq is always 0.
DIFF_MAP = {
    1: (0.20, 0.40,  0),   # Easy: simplest clinical vocabulary
    2: (0.30, 0.55,  0),   # Medium-Easy
    3: (0.45, 0.65,  0),   # Medium
    4: (0.60, 0.80,  0),   # Difficult
    5: (0.75, 1.0,   0),   # Expert
}

# ── p_dyn clipping ────────────────────────────────────────────────────────────
DECAY_MIN = 0.1
DECAY_MAX = 1.0
