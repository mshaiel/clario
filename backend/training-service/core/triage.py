import torch
import numpy as np
from dataclasses import dataclass
from typing import List, Dict

from core.constants import (
    PHONEMES, P2I, ERRORS, MAJOR_MAP, PRIORITY,
    MAJOR_NAME_TO_IDX, ENGLISH_MASK, URDU_MASK, LANGUAGE_MASKS,
)
from config import TRIAGE_THRESHOLD

def _compute_phonetic_features(phonemes: List[str]) -> List[float]:
    """
    8-dim feature vector matching the AEG data generator exactly.
    [Is_Stop, Is_Fricative, Is_Liquid, Is_Nasal, Is_Voiced, Is_Front_Labial, Is_Back_Velar, Is_Cluster]
    """
    t_str = "".join(phonemes)
    feat = [0.0] * 8
    if any(x in t_str for x in "pbtdkgʈɖʔ"):   feat[0] = 1.0  # Stop
    if any(x in t_str for x in "fvszʃʒxhθð"):   feat[1] = 1.0  # Fricative
    if any(x in t_str for x in "lrw"):            feat[2] = 1.0  # Liquid
    if any(x in t_str for x in "mnŋ"):            feat[3] = 1.0  # Nasal
    if any(x in t_str for x in "bdgvzʒðmnlrw"):  feat[4] = 1.0  # Voiced
    if any(x in t_str for x in "pbfvm"):          feat[5] = 1.0  # Front / Labial
    if any(x in t_str for x in "kgŋxɣ"):          feat[6] = 1.0  # Back / Velar
    if len(phonemes) > 1:                          feat[7] = 1.0  # Cluster context
    return feat

def _compute_trap_mask(active_phonemes: List[str], error_name: str) -> List[float]:
    """
    Full per-disorder trap masking matching the AEG training data generator.
    Activates the ×10.0 residual path in Head C for all 9 disorders.
    """
    mask = [0.0] * 64
    def forbid(sounds):
        for s in sounds:
            if s in P2I: mask[P2I[s]] = 1.0

    if error_name == "Velar Fronting":
        if any(t in ['k', 'kʰ', 'q'] for t in active_phonemes):    forbid(['t', 'tʰ', 'd'])
        if any(t in ['g', 'ɡʰ', 'ŋ'] for t in active_phonemes):    forbid(['d', 'dʰ', 'n'])
        if any(t in ['ʃ', 'ʒ', 'tʃ', 'dʒ'] for t in active_phonemes): forbid(['s', 'z'])
        if any(t in ['ʈ', 'ɖ'] for t in active_phonemes):           forbid(['t', 'd'])

    elif error_name == "Stopping":
        if any(t in ['f'] for t in active_phonemes):        forbid(['p', 'b'])
        if any(t in ['v'] for t in active_phonemes):        forbid(['b', 'p'])
        if any(t in ['s'] for t in active_phonemes):        forbid(['t', 'd'])
        if any(t in ['z'] for t in active_phonemes):        forbid(['d', 't'])
        if any(t in ['θ', 'ð'] for t in active_phonemes):  forbid(['t', 'd'])

    elif error_name == "Gliding":
        if any(t in ['r', 'l'] for t in active_phonemes):  forbid(['w', 'j'])
        if any(t in ['tʃ'] for t in active_phonemes):      forbid(['ʃ'])
        if any(t in ['dʒ'] for t in active_phonemes):      forbid(['ʒ'])

    elif error_name == "Cluster Reduction":
        # Forbid the singleton onset consonant — it's what the patient collapses to
        for p in active_phonemes:
            if p in ['s', 't', 'k', 'p', 'l', 'r', 'n', 'm']: forbid([p])

    elif error_name == "Epenthesis":
        # Forbid the schwa-class vowels most commonly inserted between consonants
        forbid(['ə', 'ɪ', 'ʊ'])

    elif error_name in ["Blocks", "Prolongation", "Repetition"]:
        # For fluency disorders forbid the trigger phonemes themselves as exercise targets
        for p in active_phonemes:
            forbid([p])

    return mask

@dataclass
class ClinicalDiagnosis:
    id: int
    error_idx: int
    error_name: str
    major_type: str
    severity: float
    active_indices: List[int]
    active_phonemes: List[str]
    position_idx: int

class TriageEngineV2:
    def __init__(self, device='cpu'):
        self.device = device

    def scan_tensor(self, tensor_3d: np.ndarray, language: str = "english") -> List[ClinicalDiagnosis]:
        """
        Scans the dense (3, 64, 9) tensor for clinical patterns.
        Applies Language Masking to filter out 'hallucinated' comorbidities from other languages.
        """
        diagnoses = []
        uid_counter = 0
        
        print(f"--- Triage Scan Initiated (Lang: {language}) ---")
        
        # We iterate through the 9 error types (columns)
        for err_idx in range(9):
            # Check for the strongest manifestation across any position/phoneme
            slice_max = np.max(tensor_3d[:, :, err_idx])
            
            # 0.6 is the clinical certainty threshold
            if slice_max > TRIAGE_THRESHOLD:
                # Find all phonemes that contributed to this diagnosis
                hits = np.where(tensor_3d[:, :, err_idx].max(axis=0) > TRIAGE_THRESHOLD)[0]
                
                # --- LANGUAGE MASKING ---
                lang = language.lower()
                active_mask = LANGUAGE_MASKS.get(lang)  # None = no masking (pass-through)
                valid_hits = []
                ignored_hits = []
                for h in hits:
                    p = PHONEMES[h]
                    if active_mask is not None and p not in active_mask:
                        ignored_hits.append(p)
                        continue
                    valid_hits.append(int(h))

                if ignored_hits:
                    print(f"   ⚠️ Masked Off-Language Signals in {ERRORS[err_idx]}: {ignored_hits}")
                
                if not valid_hits: 
                    continue

                # Bug 6 fix: derive severity only from the cells that passed language
                # masking and the TRIAGE_THRESHOLD check (i.e. valid_hits).  Using
                # the global slice_max can inflate severity with values from a
                # position/phoneme combination that did NOT contribute any active phoneme.
                hit_severity = float(tensor_3d[:, valid_hits, err_idx].max())

                # Determine dominant position for exercise targeting
                dom_pos = np.argmax(tensor_3d[:, valid_hits, err_idx].sum(axis=1))

                diag = ClinicalDiagnosis(
                    id=uid_counter,
                    error_idx=err_idx,
                    error_name=ERRORS[err_idx],
                    major_type=MAJOR_MAP[err_idx],
                    severity=hit_severity,
                    active_indices=valid_hits,
                    active_phonemes=[PHONEMES[i] for i in valid_hits],
                    position_idx=int(dom_pos)
                )
                diagnoses.append(diag)
                uid_counter += 1

        # Return sorted by clinical priority (Motor/Fluency first) then severity
        return sorted(diagnoses, key=lambda x: (PRIORITY[x.major_type], x.severity), reverse=True)

    def prepare_aeg_input(self, focus_diag: ClinicalDiagnosis, all_diagnoses: List[ClinicalDiagnosis], user_stats: List[float]) -> Dict[str, torch.Tensor]:
        """Prepares the 162-dim state vector for the AEG Policy Network."""
        # Cluster: one-hot over the affected phonemes
        cluster_mask = [0.0] * 64
        for idx in focus_diag.active_indices:
            if idx < 64: cluster_mask[idx] = 1.0

        # Trap: disorder-specific confounding phonemes (activates x10 residual in Head C)
        trap_mask = _compute_trap_mask(focus_diag.active_phonemes, focus_diag.error_name)

        # Feat: 8-dim phonetic feature flags derived from target phonemes
        feat = _compute_phonetic_features(focus_diag.active_phonemes)

        # Flags: [is_systemic, is_trap, comorb, is_child, is_maint, is_fatigued]
        # Derived from diagnosis + user_stats [severity, fatigue, age, delta]
        severity, fatigue, age = user_stats[0], user_stats[1], user_stats[2]
        is_systemic = 1.0 if len(focus_diag.active_indices) > 1 else 0.0
        is_trap     = 1.0 if focus_diag.error_name in ["Velar Fronting", "Stopping", "Gliding"] else 0.0
        comorb      = 1.0 if len(all_diagnoses) > 1 else 0.0
        is_child    = 1.0 if age < 0.3 else 0.0
        is_maint    = 1.0 if severity <= 0.2 else 0.0
        is_fatigued = 1.0 if fatigue > 0.8 else 0.0
        flags = [is_systemic, is_trap, comorb, is_child, is_maint, is_fatigued]

        # major_idx: must match AEG training MAJOR_TYPES = ["Artic", "Fluency", "Motor"]
        major_idx_val = MAJOR_NAME_TO_IDX.get(focus_diag.major_type, 0)

        return {
            "error_idx": torch.tensor([focus_diag.error_idx]).to(self.device),
            "major_idx": torch.tensor([major_idx_val]).to(self.device),
            "pos_idx":   torch.tensor([focus_diag.position_idx]).to(self.device),
            "cluster":   torch.tensor([cluster_mask], dtype=torch.float32).to(self.device),
            "trap":      torch.tensor([trap_mask],    dtype=torch.float32).to(self.device),
            "feat":      torch.tensor([feat],         dtype=torch.float32).to(self.device),
            "flags":     torch.tensor([flags],        dtype=torch.float32).to(self.device),
            "stats":     torch.tensor([user_stats],   dtype=torch.float32).to(self.device),
        }