import torch
import soundfile as sf
import io
import numpy as np
from typing import Dict, Any

# Silero VAD singleton — loaded at startup via RepairDetector.preload()
# or lazily here via _ensure_vad()
_vad_model = None
_get_speech_timestamps = None


def _ensure_vad() -> None:
    global _vad_model, _get_speech_timestamps
    if _vad_model is None:
        _vad_model, utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
        )
        _get_speech_timestamps = utils[0]


def _resample_to_16k(audio_array: np.ndarray, sr: int) -> np.ndarray:
    if sr == 16000:
        return audio_array
    new_len = int(len(audio_array) * 16000 / sr)
    return np.interp(
        np.linspace(0, len(audio_array), new_len),
        np.arange(len(audio_array)),
        audio_array,
    ).astype(np.float32)


def analyze_phonation(audio_bytes: bytes, config: Dict) -> Dict[str, Any]:
    """
    Inter-word silence analysis via Silero VAD.
    Measures silence gaps between consecutive speech segments.
    Flags gaps above max_gap_ms as 'broken' transitions.

    scoring_config keys:
        max_gap_ms  (float) — maximum allowed silence between words, default 150
    """
    _ensure_vad()
    max_gap_ms = float(config.get('max_gap_ms', 150))

    audio_array, sr = sf.read(io.BytesIO(audio_bytes))
    if audio_array.ndim > 1:
        audio_array = audio_array.mean(axis=1)

    resampled = _resample_to_16k(audio_array, sr)
    tensor = torch.FloatTensor(resampled)

    timestamps = _get_speech_timestamps(tensor, _vad_model, return_seconds=True)

    if len(timestamps) < 2:
        return {
            'success': True,
            'score': 100.0,
            'note': 'Speech was continuous or too short to analyze.',
            'total_gaps': 0,
            'broken_gaps': 0,
            'smooth_gaps': 0,
            'gaps': [],
            'feedback_key': 'good',
        }

    gaps = []
    broken_count = 0
    for i in range(len(timestamps) - 1):
        gap_ms = (timestamps[i + 1]['start'] - timestamps[i]['end']) * 1000.0
        is_broken = gap_ms > max_gap_ms
        gaps.append({'gap_ms': round(gap_ms, 1), 'broken': is_broken})
        if is_broken:
            broken_count += 1

    smooth = len(gaps) - broken_count
    score = round((smooth / len(gaps)) * 100, 2) if gaps else 100.0

    return {
        'success': True,
        'score': score,
        'total_gaps': len(gaps),
        'broken_gaps': broken_count,
        'smooth_gaps': smooth,
        'gaps': gaps,
        'feedback_key': 'good' if score >= 80 else 'needs_smoother_transitions',
    }
