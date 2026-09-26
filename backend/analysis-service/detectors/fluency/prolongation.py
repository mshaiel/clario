import logging
import numpy as np
import librosa
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass

from core.config import GLOBAL_CONFIG
from core.shared_asr import ASRResult, Word
from core.alignment import get_phone_class

logger = logging.getLogger("ProlongationDetector")

@dataclass
class ProlongationEvent:
    phone: str
    start: float
    end: float
    duration: float
    confidence: float
    source: str # "phone_based" or "spectral"
    word_context: str = "unknown"  # NEW: The word containing the prolongation

class ProlongationDetector:
    def __init__(self):
        self.config = GLOBAL_CONFIG.thresholds
        self.sample_rate = GLOBAL_CONFIG.audio.sample_rate
        
        # Spectral Settings
        self.fb_centroid_hz = 3000.0 
        self.fb_zcr = 0.12           
        self.fb_min_len_s = 0.35     

    def analyze(self, audio_path: str, asr_result: ASRResult) -> Dict[str, Any]:
        """
        Detects prolongations and maps them to specific words.
        """
        events = []
        
        # 1. Phone-Based Detection
        if hasattr(asr_result, 'phones') and asr_result.phones:
            phone_segments = [
                {"phone": p.phone, "start": p.start, "end": p.end, "dur": p.duration}
                for p in asr_result.phones
            ]
            merged_runs = self._merge_same_phone_runs(phone_segments)
            events = self._detect_from_runs(merged_runs)
            logger.info(f"📊 Phone-based detection found {len(events)} events")
        
        # 2. Spectral Fallback (Always run as backup)
        spectral_events = self._spectral_fallback(audio_path)
        logger.info(f"📊 Spectral fallback found {len(spectral_events)} events")
        
        # 3. Merge Events
        final_events = self._merge_events(events, spectral_events)
        
        # 4. Attach Word Context
        # This solves: "tell which sound was repeated and in which word"
        logger.info("🔍 Mapping events to words...")
        for event in final_events:
            event.word_context = self._find_word_context(event.start, event.end, asr_result.words)
            logger.info(f"   Event '{event.phone}' mapped to word '{event.word_context}'")

        return {
            "test_type": "prolongation",
            "detected_count": len(final_events),
            "events": [vars(e) for e in final_events]
        }

    # ─── CONTEXT LOGIC ──────────────────────────────────────────────────

    def _find_word_context(self, start: float, end: float, words: List[Word]) -> str:
        """
        Finds the word in the sentence that best matches the prolongation timeframe.
        Priority:
        1. Overlap: The prolongation happens *inside* the word boundaries.
        2. Proximity: The prolongation happens just before/after the word.
        """
        best_word = "unknown"
        max_overlap = 0.0
        
        # 1. Check for physical overlap
        for w in words:
            # Intersection calculation
            o_start = max(start, w.start)
            o_end = min(end, w.end)
            overlap = max(0, o_end - o_start)
            
            if overlap > max_overlap:
                max_overlap = overlap
                best_word = w.word
        
        # If valid overlap found, return it
        if best_word != "unknown" and max_overlap > 0:
            return best_word
            
        # 2. Fallback: Proximity (within 200ms)
        # Useful if ASR timestamps for the word are slightly shifted vs the phone event
        closest_word = None
        min_distance = 100.0
        
        for w in words:
            # Dist between end of word and start of event OR end of event and start of word
            dist = min(abs(start - w.end), abs(w.start - end))
            
            if dist < 0.2 and dist < min_distance:
                min_distance = dist
                closest_word = w.word
                
        return closest_word if closest_word else "unknown"

    # ─── PHONE LOGIC ────────────────────────────────────────────────────

    def _merge_same_phone_runs(self, phones: List[Dict]) -> List[Dict]:
        if not phones: 
            return []
        
        merged = []
        curr = phones[0].copy()
        
        for i in range(1, len(phones)):
            nxt = phones[i]
            gap = nxt['start'] - curr['end']
            
            # Merge logic
            if (curr['phone'] == nxt['phone']) and (gap < 0.12):
                curr['end'] = max(curr['end'], nxt['end'])
                curr['dur'] = curr['end'] - curr['start']
            else:
                merged.append(curr)
                curr = nxt.copy()
        merged.append(curr)
        return merged

    def _detect_from_runs(self, runs: List[Dict]) -> List[ProlongationEvent]:
        events = []
        for r in runs:
            phone = r['phone']
            dur = r['dur']
            p_class = get_phone_class(phone)
            
            # Dynamic Thresholds
            if p_class in ["FRIC", "SIBIL_S", "SIBIL_SH"]:
                thresh = 0.35 
            elif p_class == "STOP_T" or p_class == "STOP_P":
                thresh = 0.25 
            elif p_class == "VOWEL":
                thresh = 0.65 
            else:
                thresh = 0.50
            
            if dur >= thresh:
                events.append(ProlongationEvent(
                    phone=phone, start=r['start'], end=r['end'], 
                    duration=dur, confidence=0.9, source="phone_based"
                ))
        return events

    # ─── SPECTRAL LOGIC ─────────────────────────────────────────────────

    def _spectral_fallback(self, audio_path: str) -> List[ProlongationEvent]:
        y, sr = librosa.load(audio_path, sr=self.sample_rate)
        
        hop = 256
        zcr = librosa.feature.zero_crossing_rate(y, frame_length=1024, hop_length=hop)[0]
        cent = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=2048, hop_length=hop)[0]
        rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]
        times = librosa.frames_to_time(np.arange(len(zcr)), sr=sr, hop_length=hop)
        
        events = []
        
        # Masks
        fricative_mask = (cent >= 2500) & (zcr >= 0.08) & (rms > np.percentile(rms, 30))
        nasal_voiced_mask = (cent <= 1500) & (zcr <= 0.05) & (rms > np.percentile(rms, 40))
        mid_mask = (cent >= 800) & (cent <= 2500) & (zcr <= 0.15) & (rms > np.percentile(rms, 35))
        
        for mask, sound_type, min_duration in [
            (fricative_mask, "fricative", 0.3),
            (nasal_voiced_mask, "nasal_voiced", 0.4),
            (mid_mask, "mid", 0.45)
        ]:
            in_run = False
            start_idx = 0
            
            for i, is_active in enumerate(mask):
                if is_active and not in_run:
                    in_run = True
                    start_idx = i
                elif not is_active and in_run:
                    in_run = False
                    duration = times[i-1] - times[start_idx]
                    if duration >= min_duration:
                        # Map to generic phone
                        phone_map = {"fricative": "s", "nasal_voiced": "m", "mid": "ə"}
                        
                        events.append(ProlongationEvent(
                            phone=phone_map.get(sound_type, "?"),
                            start=times[start_idx], 
                            end=times[i-1],
                            duration=duration, 
                            confidence=0.6, 
                            source="spectral"
                        ))
        
        return events

    def _merge_events(self, phone_evs: List[ProlongationEvent], spec_evs: List[ProlongationEvent]) -> List[ProlongationEvent]:
        final = phone_evs.copy()
        
        for s_ev in spec_evs:
            overlap = False
            for p_ev in phone_evs:
                if (s_ev.start < p_ev.end) and (s_ev.end > p_ev.start):
                    overlap = True
                    break
            
            if not overlap:
                final.append(s_ev)
                
        return sorted(final, key=lambda x: x.start)

# Factory
def get_prolongation_detector() -> ProlongationDetector:
    return ProlongationDetector()