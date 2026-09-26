"""
core/tensor_bridge.py — Local tensor update engine for the Unified Assistant Backend.

Ported from CTM so that CUA owns all tensor update logic directly (no network hop).
Tensor update is triggered on two conditions:
  1. A mistake is made on a phoneme  → drive that error column toward 1.0
  2. A phoneme is correctly produced → drive already-tested error columns toward 0.0
     (untested cells at -1.0 are never touched on success)
"""
import numpy as np
from typing import List, Dict, Any, Optional

# ── Phoneme Inventory (64 symbols, must match CTM V7 ordering) ───────────────
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

# ── Error column indices (9 columns, must match CTM constants.py) ─────────────
ERROR_MAP: Dict[str, int] = {
    "sub": 0,            "substitution": 0,
    "front": 1,          "fronting": 1,       "velar fronting": 1,   "velar_fronting": 1,
    "stop": 2,           "stopping": 2,
    "glide": 3,          "gliding": 3,
    "clust": 4,          "cluster": 4,        "cluster reduction": 4, "cluster_reduction": 4,
    "epen": 5,           "epenthesis": 5,
    "block": 6,          "blocking": 6,       "blocks": 6,
    "prolong": 7,        "prolongation": 7,
    "repeat": 8,         "repetition": 8,     "stutter": 8,
}


class TensorBridge:
    """
    Owns all tensor update arithmetic for the UAB.
    No HTTP calls — runs in-process next to FirestoreService.
    """

    def __init__(self):
        # IPA variant normalisation (variants → canonical form)
        self._ipa_clean: Dict[str, str] = {"g": "g", "ɡ": "g", "r": "r", "ɾ": "r"}

    # ── Public interface ──────────────────────────────────────────────────────

    def initialize_tensor(self) -> List:
        """Returns a fresh 3×64×9 tensor initialised to -1.0 (Untested)."""
        return np.full((3, 64, 9), -1.0, dtype=np.float32).tolist()

    def update_tensor(
        self,
        current_tensor_blob: Optional[List],
        events: List[Dict[str, Any]],
        learning_rate: float = 0.2,
    ) -> List:
        """
        Apply a batch of parsed tensor events (output of parse_events) to the tensor.

        Args:
            current_tensor_blob: Existing 3×64×9 tensor (None → initialise fresh).
            events:              List of dicts from parse_events().
            learning_rate:       EMA alpha (0 < α ≤ 1).

        Returns:
            Updated tensor as a nested Python list (3×64×9).
        """
        if not (0.0 < learning_rate <= 1.0):
            raise ValueError("learning_rate must be in (0.0, 1.0].")

        if current_tensor_blob is None:
            tensor = np.full((3, 64, 9), -1.0, dtype=np.float32)
        else:
            tensor = np.array(current_tensor_blob, dtype=np.float32)
            if tensor.shape != (3, 64, 9):
                raise ValueError("current_tensor must have shape (3, 64, 9).")

        for ev in events:
            c = ev["pos_idx"]       # position axis  (0=initial, 1=medial, 2=final)
            h = ev["phoneme_idx"]   # phoneme row

            if ev["is_correct"]:
                # ── Success: drive already-tested slots toward 0.0 via EMA.
                # If completely untested, initialise the entire row to 0.0 (healthy).
                valid_mask = tensor[c, h, :] >= 0.0
                if not np.any(valid_mask):
                    tensor[c, h, :] = 0.0
                else:
                    tensor[c, h, :][valid_mask] = (
                        tensor[c, h, :][valid_mask] * (1.0 - learning_rate)
                    )
            else:
                # ── Error: drive the specific error column toward 1.0.
                w = ev["error_idx"]
                current_val = tensor[c, h, w]
                if current_val == -1.0:
                    # First observation of this error → immediate full confidence
                    tensor[c, h, w] = 1.0
                else:
                    # Recurring error → EMA toward 1.0
                    tensor[c, h, w] = current_val * (1.0 - learning_rate) + learning_rate

            # Clamp all tested cells to [0.0, 1.0]
            tested = tensor >= 0.0
            tensor[tested] = np.clip(tensor[tested], 0.0, 1.0)

        return tensor.tolist()

    def parse_events(self, new_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Convert a flat list of error/success records into normalised tensor events.

        Each record must contain:
          - phoneme      : IPA symbol of the target phoneme
          - error_type   : clinical error name (e.g. "stopping") OR "correct"
          - position     : "initial" | "medial" | "final"   (optional, default "initial")
          - is_correct   : bool (optional; inferred from error_type if absent)

        Returns a list of dicts with keys: phoneme_idx, error_idx, pos_idx, is_correct.
        Records with unrecognised phonemes or unknown error types are skipped.
        """
        parsed = []
        for item in new_results:
            phoneme = item.get("phoneme") or item.get("expected") or item.get("phone")
            clean_phoneme = self._unify_phoneme(phoneme)
            if not clean_phoneme:
                continue  # unrecognisable phoneme → skip

            is_correct = bool(item.get("is_correct", False))
            error_type_raw = str(item.get("error_type") or item.get("result") or "").lower().strip()

            # Determine is_correct from error_type string if flag not explicit
            if error_type_raw in {"correct", "none", "no error", ""}:
                is_correct = True

            err_idx = -1
            if not is_correct:
                err_idx = ERROR_MAP.get(error_type_raw, -1)
                if err_idx == -1:
                    # Try normalised variants
                    for key, val in ERROR_MAP.items():
                        if key in error_type_raw:
                            err_idx = val
                            break
                if err_idx == -1:
                    # Unknown error type — cannot update; skip
                    continue

            parsed.append({
                "phoneme_idx": P2I[clean_phoneme],
                "error_idx":   err_idx,
                "pos_idx":     self._position_to_idx(item.get("position", "initial")),
                "is_correct":  is_correct,
            })

        return parsed

    # ── Private helpers ───────────────────────────────────────────────────────

    def _unify_phoneme(self, symbol: Optional[str]) -> Optional[str]:
        if not symbol:
            return None
        if symbol in P2I:
            return symbol
        cleaned = self._ipa_clean.get(symbol)
        if cleaned and cleaned in P2I:
            return cleaned
        # Try first character (for multi-char variants like 'kʰ' sent as just 'k')
        if len(symbol) > 1 and symbol[0] in P2I:
            return symbol[0]
        return None

    @staticmethod
    def _position_to_idx(pos_str: str) -> int:
        p = str(pos_str).lower()
        if any(x in p for x in ("init", "start")):
            return 0
        if any(x in p for x in ("med", "mid")):
            return 1
        if any(x in p for x in ("fin", "end")):
            return 2
        return 0  # default: initial
