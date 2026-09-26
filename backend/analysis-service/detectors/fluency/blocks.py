import logging
import numpy as np
import librosa
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass

from core.config import GLOBAL_CONFIG
from core.shared_asr import ASRResult, Phone, Word

logger = logging.getLogger("BlocksDetector")

# Updated Data Class
@dataclass
class BlockEvent:
    type: str  # "BlockBetweenWords" or "BlockWithinWord"
    start: float
    end: float
    duration: float
    confidence: float
    # Context fields
    word: Optional[str] = None         # For WithinWord
    prev_word: Optional[str] = None    # For BetweenWords
    next_word: Optional[str] = None    # For BetweenWords
    text_context: str = ""             # User-friendly string

class BlocksDetector:
    def __init__(self):
        self.config = GLOBAL_CONFIG.thresholds
        self.sample_rate = GLOBAL_CONFIG.audio.sample_rate
        self.min_block_ms = self.config.min_block_ms
        
        logger.info(f"BlocksDetector initialized (min_block_ms: {self.min_block_ms})")

    def analyze(self, audio_path: str, asr_result: ASRResult) -> Dict[str, Any]:
        """
        Main analysis pipeline:
        1. Load audio and detect silences using bimodal distribution
        2. Determine speech boundaries (trim leading/trailing silence)
        3. Classify silences as blocks using phone boundaries
        """
        try:
            # 1. Load Audio
            logger.info(f"🎵 Loading audio: {audio_path}")
            y, sr = librosa.load(audio_path, sr=self.sample_rate, mono=True)
            audio_duration = len(y) / sr
            logger.info(f"   ✅ Loaded: {audio_duration:.2f}s, {sr}Hz")
            
            # 2. Detect Silences (Bimodal Distribution Method)
            silences = self._detect_silences_bimodal(y, sr)
            
            # 3. Get Speech Boundaries
            speech_start, speech_end = self._get_speech_boundaries(silences, audio_duration)
            
            # 4. Classify Blocks using Phone Boundaries
            blocks = self._classify_silences(
                silences, 
                asr_result.phones, 
                asr_result.words,
                speech_start, 
                speech_end
            )
            
            logger.info(f"🎉 Analysis complete: {len(blocks)} blocks detected")
            
            return {
                "test_type": "blocks",
                "detected_count": len(blocks),
                "events": [vars(b) for b in blocks],
                "debug": {
                    "total_silences": len(silences),
                    "speech_duration": speech_end - speech_start,
                    "audio_duration": audio_duration
                }
            }
            
        except Exception as e:
            logger.error(f"BlocksDetector error: {e}", exc_info=True)
            return {
                "test_type": "blocks",
                "detected_count": 0,
                "events": [],
                "error": str(e)
            }

    # ═══════════════════════════════════════════════════════════════════════
    # STEP 1: BIMODAL SILENCE DETECTION
    # ═══════════════════════════════════════════════════════════════════════

    def _detect_silences_bimodal(self, y: np.ndarray, sr: int) -> List[Tuple[float, float]]:
        """
        Bimodal distribution approach to silence detection.
        """
        logger.info("🔍 Step 1: Detecting silences using bimodal distribution...")
        
        # Calculate RMS energy in small frames
        frame_length = 512  # ~32ms at 16kHz
        hop_length = 256    # 50% overlap
        
        rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
        
        # Bimodal distribution approach
        rms_sorted = np.sort(rms)
        
        # Find the biggest jump in energy (gap between silence and speech clusters)
        diffs = np.diff(rms_sorted)
        biggest_jump_idx = np.argmax(diffs)
        
        # Threshold is right after the biggest jump
        threshold = rms_sorted[biggest_jump_idx] + (diffs[biggest_jump_idx] * 0.5)
        
        # Fallback if bimodal approach fails
        if threshold < 1e-5 or threshold > np.median(rms):
            threshold = np.median(rms) * 0.3
        
        # Convert to silence flags
        is_silent = (rms < threshold).astype(int)
        
        # Convert frame indices to time
        times = librosa.frames_to_time(
            np.arange(len(is_silent)),
            sr=sr,
            hop_length=hop_length
        )
        
        silences = []
        in_silence = False
        silence_start = 0
        
        for i, silent in enumerate(is_silent):
            if silent and not in_silence:
                in_silence = True
                silence_start = times[i]
            elif not silent and in_silence:
                in_silence = False
                duration_ms = (times[i - 1] - silence_start) * 1000
                
                if duration_ms >= self.min_block_ms:
                    silences.append((silence_start, times[i - 1]))
        
        # Handle case where audio ends in silence
        if in_silence and len(times) > 0:
            duration_ms = (times[-1] - silence_start) * 1000
            if duration_ms >= self.min_block_ms:
                silences.append((silence_start, times[-1]))
        
        return silences

    # ═══════════════════════════════════════════════════════════════════════
    # STEP 2: SPEECH BOUNDARIES
    # ═══════════════════════════════════════════════════════════════════════

    def _get_speech_boundaries(self, silences: List[Tuple[float, float]], 
                               audio_duration: float) -> Tuple[float, float]:
        """
        Determine where actual speech starts and ends.
        """
        if not silences:
            return 0.0, audio_duration
        
        first_silence_end = silences[0][1] if silences[0][0] < 0.5 else 0.0
        last_silence_start = silences[-1][0] if (audio_duration - silences[-1][1]) < 0.5 else audio_duration
        
        return first_silence_end, last_silence_start

    # ═══════════════════════════════════════════════════════════════════════
    # STEP 3: PHONE-BASED CLASSIFICATION
    # ═══════════════════════════════════════════════════════════════════════

    def _find_phone_before(self, time: float, phones: List[Phone]) -> Optional[Phone]:
        candidates = [p for p in phones if p.end <= time]
        return max(candidates, key=lambda p: p.end) if candidates else None

    def _find_phone_after(self, time: float, phones: List[Phone]) -> Optional[Phone]:
        candidates = [p for p in phones if p.start >= time]
        return min(candidates, key=lambda p: p.start) if candidates else None

    def _find_word_containing_time(self, time: float, words: List[Word]) -> Optional[Word]:
        for word in words:
            if word.start <= time <= word.end:
                return word
        return None

    def _classify_silences(self, 
                          silences: List[Tuple[float, float]],
                          phones: List[Phone],
                          words: List[Word],
                          speech_start: float,
                          speech_end: float) -> List[BlockEvent]:
        """
        Classify silences as blocks using PHONE BOUNDARIES.
        Populates the updated BlockEvent data class.
        """
        logger.info("🎯 Step 3: Classifying silences as blocks...")
        
        inner_silences = [
            (start, end) for start, end in silences
            if start >= speech_start and end <= speech_end
        ]
        
        blocks = []
        
        for idx, (silence_start, silence_end) in enumerate(inner_silences):
            duration = silence_end - silence_start
            
            phone_before = self._find_phone_before(silence_start, phones)
            phone_after = self._find_phone_after(silence_end, phones)
            
            if not phone_before or not phone_after:
                continue
            
            phone_gap = phone_after.start - phone_before.end
            
            # DECISION LOGIC
            if phone_gap > 0.3:  # More than 300ms gap between phones
                # CASE 1: Block BETWEEN words/phones
                word_before = self._find_word_containing_time(phone_before.end, words)
                word_after = self._find_word_containing_time(phone_after.start, words)
                
                if word_before and word_after and word_before.word != word_after.word:
                    # Valid Word-to-Word Block
                    blocks.append(BlockEvent(
                        type="BlockBetweenWords",
                        start=silence_start,
                        end=silence_end,
                        duration=duration,
                        confidence=0.90,
                        prev_word=word_before.word,
                        next_word=word_after.word,
                        text_context=f"Between '{word_before.word}' and '{word_after.word}'"
                    ))
                else:
                    # Fallback (Context unclear or between phones)
                    blocks.append(BlockEvent(
                        type="BlockBetweenPhones",
                        start=silence_start,
                        end=silence_end,
                        duration=duration,
                        confidence=0.85,
                        text_context=f"Between sounds /{phone_before.phone}/ and /{phone_after.phone}/"
                    ))
            else:
                # CASE 2: Block WITHIN a word
                containing_word = self._find_word_containing_time(silence_start, words)
                
                if containing_word:
                    blocks.append(BlockEvent(
                        type="BlockWithinWord",
                        start=silence_start,
                        end=silence_end,
                        duration=duration,
                        confidence=0.95,
                        word=containing_word.word,
                        text_context=f"Inside word '{containing_word.word}'"
                    ))
                else:
                    # Fallback for within-word detection failure
                    blocks.append(BlockEvent(
                        type="BlockBetweenPhones",
                        start=silence_start,
                        end=silence_end,
                        duration=duration,
                        confidence=0.80,
                        text_context="Between phones (word unclear)"
                    ))
        
        logger.info(f"\n   🎉 Total blocks detected: {len(blocks)}")
        return blocks

# Factory
def get_blocks_detector() -> BlocksDetector:
    return BlocksDetector()