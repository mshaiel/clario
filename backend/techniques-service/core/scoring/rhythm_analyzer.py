import numpy as np
from typing import List, Dict, Any


def analyze_rhythm(tap_times_ms: List[float], config: Dict) -> Dict[str, Any]:
    """
    Evaluate tap regularity and tempo accuracy against an expected BPM.
    Tap timestamps (in milliseconds) are collected by the Flutter frontend.

    scoring_config keys:
        expected_bpm    (float) — target beats per minute, default 60

    Score = regularity * 0.6 + tempo_accuracy * 0.4
    """
    expected_bpm = float(config.get('expected_bpm', 60))

    if len(tap_times_ms) < 3:
        return {
            'success': False,
            'score': 0.0,
            'error': 'Need at least 3 taps to evaluate rhythm.',
        }

    intervals = [tap_times_ms[i + 1] - tap_times_ms[i] for i in range(len(tap_times_ms) - 1)]
    expected_ms = 60000.0 / expected_bpm
    mean_interval = float(np.mean(intervals))
    std_interval = float(np.std(intervals))

    # Regularity: lower std relative to expected = more regular
    regularity = max(0.0, 1.0 - (std_interval / expected_ms))

    # Tempo accuracy: how close mean interval is to target
    tempo_acc = max(0.0, 1.0 - abs(mean_interval - expected_ms) / expected_ms)

    score = round((regularity * 0.6 + tempo_acc * 0.4) * 100, 2)
    actual_bpm = 60000.0 / mean_interval if mean_interval > 0 else 0.0

    if score >= 75:
        feedback_key = 'good'
    elif regularity < 0.6:
        feedback_key = 'too_irregular'
    else:
        feedback_key = 'wrong_tempo'

    return {
        'success': True,
        'score': score,
        'actual_bpm': round(actual_bpm, 1),
        'expected_bpm': expected_bpm,
        'regularity': round(regularity, 3),
        'tempo_accuracy': round(tempo_acc, 3),
        'tap_count': len(tap_times_ms),
        'mean_interval_ms': round(mean_interval, 1),
        'feedback_key': feedback_key,
    }
