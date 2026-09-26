import parselmouth
import numpy as np
import soundfile as sf
import io
import tempfile
import os
from typing import Dict, Any


import librosa

def analyze_rate(audio_bytes: bytes, config: Dict) -> Dict[str, Any]:
    """
    Measure syllable rate via Praat syllable nucleus detection (SPM).
    Language-agnostic: counts vowel energy peaks, not words.
    Unaffected by stuttered repetitions — correct for clinical use.

    scoring_config keys:
        target_spm      (float) — target syllables per minute, default 220
        tolerance_pct   (float) — ±tolerance fraction, default 0.25
    """
    target_spm = float(config.get('target_spm', 220))
    tolerance = float(config.get('tolerance_pct', 0.25))

    audio_array, sr = sf.read(io.BytesIO(audio_bytes))
    if audio_array.ndim > 1:
        audio_array = audio_array.mean(axis=1)

    # Trim leading and trailing silence to get accurate speaking rate
    audio_array, _ = librosa.effects.trim(audio_array, top_db=30)

    # Write to temp file for parselmouth
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        sf.write(f.name, audio_array, sr)
        tmp_path = f.name

    try:
        snd = parselmouth.Sound(tmp_path)
    finally:
        os.unlink(tmp_path)

    # Praat intensity-based syllable nucleus counting
    intensity = snd.to_intensity(minimum_pitch=75.0)
    duration = snd.duration

    intensity_values = intensity.values[0]
    mean_intensity = float(np.mean(intensity_values))
    threshold = mean_intensity - 8.0  # 8 dB below mean

    syllable_count = 0
    in_peak = False
    for v in intensity_values:
        if v > threshold and not in_peak:
            syllable_count += 1
            in_peak = True
        elif v <= threshold:
            in_peak = False

    actual_spm = (syllable_count / duration) * 60.0 if duration > 0 else 0.0

    lower = target_spm * (1 - tolerance)
    upper = target_spm * (1 + tolerance)
    in_range = lower <= actual_spm <= upper

    if in_range:
        score = 100.0
    else:
        deviation = abs(actual_spm - target_spm) / target_spm
        score = max(0.0, 100.0 - deviation * 200.0)

    if in_range:
        feedback_key = 'good'
    elif actual_spm > upper:
        feedback_key = 'too_fast'
    else:
        feedback_key = 'too_slow'

    return {
        'success': True,
        'score': round(score, 2),
        'actual_spm': round(actual_spm, 1),
        'target_spm': target_spm,
        'syllable_count': syllable_count,
        'duration_sec': round(duration, 2),
        'in_range': in_range,
        'feedback_key': feedback_key,
    }
