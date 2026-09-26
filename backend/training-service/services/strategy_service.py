"""
services/strategy_service.py — Business logic for the /strategy/generate pipeline.
Extracted from main.py so it is testable and independent of HTTP concerns.
"""
import torch
import numpy as np

from config import (
    DEVICE, FORMAT_MAP, STRUCTURE_MAP,
    AEG_MIN_VOLUME, AEG_MAX_VOLUME, AEG_FORBIDDEN_TOPK,
    DECAY_MIN, DECAY_MAX,
)
from core.constants import PHONEMES
from schemas import StrategyGeneratePayload


def infer_production_mode(difficulty: int) -> str:
    if difficulty <= 2:
        return "imitation"
    if difficulty <= 4:
        return "elicited"
    return "spontaneous"


def level_success_criteria(difficulty: int) -> dict:
    threshold = 0.8 if difficulty <= 3 else 0.85
    return {
        "accuracy_threshold": threshold,
        "consecutive_trials": 3,
    }


def prepare_amlm_input(raw_tensor_list, validity_mask: np.ndarray) -> torch.Tensor:
    """
    Converts a raw (3,64,9) tensor list into the 6-channel model input tensor.

    Bug 2 fix: apply validity_mask to both the value map and the visibility map
    *before* concatenation so physically impossible phoneme-error combinations
    (e.g., vowels in the Velar Fronting column) are always presented to the
    encoder as zero-value / unseen cells, matching the training-data distribution.
    """
    raw = np.array(raw_tensor_list, dtype=np.float32)
    val_map = np.copy(raw)
    val_map[val_map == -1.0] = 0.0
    vis_map = np.zeros_like(raw)
    vis_map[raw != -1.0] = 1.0
    # Apply validity mask: zero out cells that are linguistically impossible.
    val_map = val_map * validity_mask
    vis_map = vis_map * validity_mask
    input_numpy = np.concatenate([val_map, vis_map], axis=0)
    return torch.FloatTensor(input_numpy).unsqueeze(0).to(DEVICE)


async def run_strategy_pipeline(payload: StrategyGeneratePayload, models: dict, validity_mask: np.ndarray) -> dict:
    """
    Full AMLM → Triage → AEG → ACG pipeline.
    Returns the structured response dict ready to be returned by the route.
    """
    amlm   = models['amlm']
    aeg    = models['aeg']
    triage = models['triage']
    acg    = models['acg']

    # ── 1. AMLM Inference ─────────────────────────────────────────────────────
    amlm_input = prepare_amlm_input(payload.current_tensor, validity_mask)
    with torch.no_grad():
        diagnosis_map, _ = amlm(amlm_input)
        diag_np = diagnosis_map[0].cpu().numpy() * validity_mask

    # ── 2. Triage ─────────────────────────────────────────────────────────────
    all_diagnoses = triage.scan_tensor(diag_np, language=payload.language)

    if not all_diagnoses:
        return {"status": "healthy", "message": "No significant errors detected."}

    # ── 3. Generation Loop ────────────────────────────────────────────────────
    session_exercise_sets = []

    for focus_diag in all_diagnoses:
        stats = payload.user_stats
        # Bug 1 fix: force_easier should reduce the difficulty level, not misreport
        # the user's fatigue.  We clamp *severity* to a comfortable mid-range cap
        # (≤0.5) so AEG produces simpler exercises while leaving all other stats
        # (fatigue, age, delta) accurate.
        effective_severity = min(stats.severity, 0.5) if payload.force_easier else stats.severity

        aeg_inputs = triage.prepare_aeg_input(
            focus_diag, all_diagnoses,
            [effective_severity, stats.fatigue, stats.age, stats.delta]
        )

        with torch.no_grad():
            p_vol, p_diff, p_fmt, p_targ, p_struct, p_forbid, p_dyn = aeg(
                aeg_inputs['error_idx'], aeg_inputs['major_idx'], aeg_inputs['pos_idx'],
                aeg_inputs['cluster'],   aeg_inputs['trap'],      aeg_inputs['feat'],
                aeg_inputs['flags'],     aeg_inputs['stats'],
            )

        # ── p_dyn → exercise_params ──────────────────────────────────────────
        dyn_raw = p_dyn[0].tolist()
        exercise_params = {
            "syllable_range": [max(1, round(dyn_raw[0])), max(1, round(dyn_raw[1]))],
            "batch_size":     [max(1, round(dyn_raw[2])), max(1, round(dyn_raw[3]))],
            "decay":          round(float(np.clip(dyn_raw[4], DECAY_MIN, DECAY_MAX)), 2),
        }

        # Bug 4 fix: int() truncates toward zero (e.g. int(3.7) == 3).  Use
        # round() first so the model's intended level count is preserved.
        vol             = int(round(torch.clamp(p_vol, AEG_MIN_VOLUME, AEG_MAX_VOLUME).item()))
        diff_seq        = (torch.argmax(p_diff, dim=2)[0] + 1).tolist()[:vol]
        
        # Enforce diversity in formats (avoid consecutive duplicates)
        fmt_indices     = torch.argmax(p_fmt,    dim=2)[0].tolist()[:vol]
        for i in range(1, vol):
            if fmt_indices[i] == fmt_indices[i-1]:
                top2 = torch.topk(p_fmt[0][i], 2).indices.tolist()
                fmt_indices[i] = top2[1] if top2[0] == fmt_indices[i-1] else top2[0]
                
        struct_indices  = torch.argmax(p_struct, dim=2)[0].tolist()[:vol]
        target_logits   = p_targ[0][:vol]

        # Head C → forbidden targets
        top_forbidden   = torch.topk(p_forbid[0], k=AEG_FORBIDDEN_TOPK).indices.tolist()
        forbidden_targets = [PHONEMES[i] for i in top_forbidden if i < len(PHONEMES)]
        # Keep at least the diagnosis targets available for practice.
        forbidden_targets = [p for p in forbidden_targets if p not in focus_diag.active_phonemes]

        levels = []
        for i in range(vol):
            active_indices = (
                torch.sigmoid(target_logits[i]) > 0.5
            ).nonzero(as_tuple=True)[0].tolist()
            targets = [PHONEMES[idx] for idx in active_indices] or focus_diag.active_phonemes
            targets = [p for p in targets if p not in forbidden_targets]
            if not targets:
                safe_targets = [p for p in focus_diag.active_phonemes if p not in forbidden_targets]
                targets = safe_targets or focus_diag.active_phonemes[:1]

            blueprint = {
                "format":           FORMAT_MAP[fmt_indices[i]],
                "targets":          targets,
                "difficulty":       diff_seq[i],
                "structure":        STRUCTURE_MAP[struct_indices[i]],
                "forbidden_targets": forbidden_targets,
                "position_idx":     focus_diag.position_idx,
            }

            items = await acg.generate_step_content(
                blueprint, focus_diag.error_name, language=payload.language
            )

            levels.append({
                "level_index": i + 1,
                "format":      FORMAT_MAP[fmt_indices[i]],
                "difficulty":  diff_seq[i],
                "structure":   STRUCTURE_MAP[struct_indices[i]],
                "production_mode": infer_production_mode(diff_seq[i]),
                "success_criteria": level_success_criteria(diff_seq[i]),
                "items":       items,
            })

        session_exercise_sets.append({
            "diagnosis": {
                "error_name": focus_diag.error_name,
                "major_type": focus_diag.major_type,
                "severity": round(float(focus_diag.severity), 4),
                "active_phonemes": focus_diag.active_phonemes,
                "position": ["Initial", "Medial", "Final"][focus_diag.position_idx],
            },
            "impediment":     focus_diag.error_name,
            "type":           focus_diag.major_type,
            "exercise_params": exercise_params,
            "levels":         levels,
        })

    return {
        "status":        "generated",
        "language":      payload.language,
        "exercise_sets": session_exercise_sets,
    }
