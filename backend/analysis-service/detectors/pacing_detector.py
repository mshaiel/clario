import logging
import numpy as np
from typing import List, Dict, Any, Tuple
from core.asr_models import get_asr_loader

logger = logging.getLogger("PacingDetector")

class PacingDetector:
    def __init__(self):
        self.asr_loader = get_asr_loader()

    def analyze_pacing(self, audio_path: str, expected_text: str, target_wpm: float, language: str) -> Dict[str, Any]:
        """
        Analyzes the pacing of an audio recording using word-level transcription timestamps.
        """
        # 1. Transcribe the audio to get word-level timestamps
        # We don't use phonology settings because we want standard word transcription.
        # We pass expected_text as a prompt to heavily bias Whisper toward transcribing the correct words.
        logger.info(f"🎤 [PacingDetector] Analyzing pacing. Expected: '{expected_text}', Target WPM: {target_wpm}")
        words_data = self.asr_loader.transcribe_words(
            audio_path, 
            use_phonology_settings=False, 
            prompt=expected_text,
            language=language
        )

        if not words_data:
            return {
                "success": False,
                "metrics": {
                    "target_wpm": target_wpm,
                    "actual_active_wpm": 0.0,
                    "rhythm_variance": 0.0,
                    "is_pace_good": False,
                    "is_rhythm_consistent": False
                },
                "feedback": "Could not detect any words.",
                "words": []
            }

        # 2. Filter out words that might be noise (optional: we just trust Whisper for now)
        # Sort by start time just in case
        words_data.sort(key=lambda x: x["start"])

        # 3. Calculate Metrics
        first_word = words_data[0]
        last_word = words_data[-1]

        active_duration = last_word["end"] - first_word["start"]
        num_words = len(words_data)

        logger.info(f"📊 [PacingDetector] Transcribed {num_words} words in {active_duration:.2f}s active duration.")
        for i, w in enumerate(words_data):
            logger.info(f"   Word {i}: '{w['word']}' [{w['start']:.2f}s - {w['end']:.2f}s]")

        # Calculate Active WPM
        if active_duration > 0:
            actual_active_wpm = (num_words / active_duration) * 60.0
        else:
            actual_active_wpm = 0.0

        # Calculate Rhythm Variance
        intervals = []
        for i in range(1, len(words_data)):
            # Time between start of current word and start of next word
            gap = words_data[i]["start"] - words_data[i-1]["start"]
            intervals.append(gap)

        if intervals:
            rhythm_variance = float(np.std(intervals))
            logger.info(f"📏 [PacingDetector] Intervals: {[round(gap, 2) for gap in intervals]} -> Variance: {rhythm_variance:.3f}")
        else:
            rhythm_variance = 0.0
            logger.info(f"📏 [PacingDetector] Not enough words for rhythm variance.")

        # 4. Pass / Fail Logic
        # The user only fails if they underperform (speak too slowly). Overperforming (speaking fast) is fine.
        # Allow up to 25% underperformance from target WPM for a pass.
        min_acceptable_wpm = target_wpm * 0.75
        is_pace_good = actual_active_wpm >= min_acceptable_wpm

        # Rhythm consistency: standard deviation of intervals should be relatively small
        # E.g., variance < 0.35 seconds is highly consistent
        is_rhythm_consistent = rhythm_variance < 0.35

        logger.info(f"✅ [PacingDetector] WPM: {actual_active_wpm:.1f} (Target: {target_wpm}, Min: {min_acceptable_wpm:.1f}) -> Pace Good? {is_pace_good}")
        logger.info(f"✅ [PacingDetector] Variance: {rhythm_variance:.3f} -> Rhythm Consistent? {is_rhythm_consistent}")

        # Feedback message
        if is_pace_good and is_rhythm_consistent:
            feedback = "Great rhythm! You matched the pendulum well."
        elif not is_pace_good:
            feedback = "A bit too slow. Try to keep up with the pendulum."
        else:
            feedback = "Your overall speed was good, but try to keep the rhythm more consistent."

        # Format words for response
        formatted_words = [
            {"word": w["word"], "start": w["start"], "end": w["end"]} 
            for w in words_data
        ]

        return {
            "success": True,
            "metrics": {
                "target_wpm": target_wpm,
                "actual_active_wpm": round(actual_active_wpm, 1),
                "rhythm_variance": round(rhythm_variance, 3),
                "is_pace_good": is_pace_good,
                "is_rhythm_consistent": is_rhythm_consistent
            },
            "feedback": feedback,
            "words": formatted_words
        }

def get_pacing_detector() -> PacingDetector:
    return PacingDetector()
