import librosa
import soundfile as sf
import io
import numpy as np
from typing import Dict, Any


def analyze_voice_quality(audio_bytes: bytes, config: Dict) -> Dict[str, Any]:
    """
    Whisper-to-Voice transition scoring via librosa RMS energy ramp.
    Measures whether energy rises smoothly from whispered onset (low RMS)
    to modal voicing (high RMS) across the recording.

    A good whisper→voice transition has an end/start energy ratio >= 2.5.
    Score formula: min(100, max(0, (ratio - 1.0) * 40))

    scoring_config: no required keys — uses defaults.
    """
    audio_array, sr = sf.read(io.BytesIO(audio_bytes))
    if audio_array.ndim > 1:
        audio_array = audio_array.mean(axis=1)

    if len(audio_array) / sr < 0.5:
        return {
            'success': False,
            'score': 0.0,
            'error': 'Recording too short (< 0.5 seconds).',
        }

    frame_length = int(sr * 0.05)   # 50 ms frames
    hop_length = frame_length // 2

    rms = librosa.feature.rms(
        y=audio_array.astype(np.float32),
        frame_length=frame_length,
        hop_length=hop_length,
    )[0]

    n = len(rms)
    third = max(1, n // 3)
    e_start = float(np.mean(rms[:third]))
    e_end = float(np.mean(rms[2 * third:]))

    ratio = e_end / (e_start + 1e-9)
    score = min(100.0, max(0.0, (ratio - 1.0) * 40.0))

    return {
        'success': True,
        'score': round(score, 2),
        'energy_ratio': round(ratio, 3),
        'start_energy': round(e_start, 6),
        'end_energy': round(e_end, 6),
        'feedback_key': 'good' if score >= 70 else 'voice_onset_too_abrupt',
    }
