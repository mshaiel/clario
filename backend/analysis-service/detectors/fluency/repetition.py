import logging
import numpy as np
import librosa
from collections import Counter
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from core.config import GLOBAL_CONFIG
from core.shared_asr import ASRResult, Word
from core.alignment import is_stutter_variant, get_phone_class

logger = logging.getLogger("RepetitionDetector")

@dataclass
class RepetitionEvent:
    type: str  # "WordRepetition", "SyllableRepetition", "SoundRepetition", "SignalRepetition"
    unit: str  # The unit being repeated (e.g., "b", "ba", "ball")
    count: int
    start: float
    end: float
    confidence: float
    word_context: str = "unknown"

class RepetitionDetector:
    def __init__(self):
        self.config = GLOBAL_CONFIG.thresholds
        self.sample_rate = GLOBAL_CONFIG.audio.sample_rate
        
        # Tuning Parameters
        self.MAX_GAP_PHONES = 0.50  
        self.MAX_GAP_WORDS = 0.65   
        
        # Signal Processing Tuners
        self.SIGNAL_MIN_GAP = 0.05
        self.SIGNAL_MAX_GAP = 0.35
        self.SIGNAL_MIN_COUNT = 2 

    def analyze(self, audio_path: str, asr_result: ASRResult) -> Dict[str, Any]:
        """
        Multi-tier repetition detection with PHONETICALLY VERIFIED SIGNAL FUSION.
        """
        phones = [{"phone": p.phone, "start": p.start, "end": p.end} for p in asr_result.phones]
        words = asr_result.words
        
        events = []
        
        # ─── TIER 1-3: AI BASED DETECTION ───
        events.extend(self._detect_word_repetitions(words))
        events.extend(self._detect_syllable_repetitions(phones))
        sound_events = self._detect_sound_repetitions(phones)
        
        # ─── TIER 4: SIGNAL BASED DETECTION ───
        # Validates physics against known word boundaries to avoid "Banana" errors
        signal_events = self._detect_signal_repetitions(audio_path, phones, words)
        
        # ─── FUSION & VALIDATION ───
        fused_sound_events = self._fuse_signal_and_ai(sound_events, signal_events)
        events.extend(fused_sound_events)
        
        # ─── MERGE & CLEAN ───
        final_events = self._resolve_overlaps(events)
        
        # ─── CONTEXT MAPPING ───
        logger.info("🔍 Mapping repetitions to words...")
        for event in final_events:
            if event.word_context == "unknown":
                event.word_context = self._find_word_context(event.start, event.end, words)
            logger.info(f"   Event '{event.unit}' ({event.type}) -> '{event.word_context}'")

        return {
            "test_type": "repetition",
            "detected_count": len(final_events),
            "events": [vars(e) for e in final_events]
        }

    # ══════════════════════════════════════════════════════════════════════
    # TIER 4: SIGNAL REPETITIONS (Physics + Verification)
    # ══════════════════════════════════════════════════════════════════════

    def _detect_signal_repetitions(self, audio_path: str, phones: List[Dict], words: List[Word]) -> List[RepetitionEvent]:
        try:
            # 1. Load & Normalize
            y, sr = librosa.load(audio_path, sr=self.sample_rate)
            max_val = np.max(np.abs(y))
            if max_val > 0: y = y / max_val
            
            # 2. Detect Onsets
            # We keep delta low (0.08) to catch soft stutters, but rely on _process_signal_cluster to filter noise
            onset_frames = librosa.onset.onset_detect(
                y=y, sr=sr, wait=5, pre_avg=5, post_avg=5, delta=0.08
            )
            onset_times = librosa.frames_to_time(onset_frames, sr=sr)

            if len(onset_times) < 2: return []

            # 3. Cluster Analysis
            iois = np.diff(onset_times)
            events = []
            consecutive = 0
            start_idx = 0

            for i, gap in enumerate(iois):
                if self.SIGNAL_MIN_GAP <= gap <= self.SIGNAL_MAX_GAP:
                    if consecutive == 0: start_idx = i
                    consecutive += 1
                else:
                    if consecutive >= self.SIGNAL_MIN_COUNT:
                        self._process_signal_cluster(events, onset_times, start_idx, consecutive, phones, words)
                    consecutive = 0

            if consecutive >= self.SIGNAL_MIN_COUNT:
                self._process_signal_cluster(events, onset_times, start_idx, consecutive, phones, words)

            logger.info(f"📊 Signal analysis found {len(events)} verified stutter clusters")
            return events

        except Exception as e:
            logger.error(f"Signal detection failed: {e}")
            return []

    def _process_signal_cluster(self, events_list, onset_times, start_idx, count, phones, words):
        """
        Validates a signal cluster. Checks:
        1. Phonetic Consistency (Are sounds similar?)
        2. Word Overlap (Is this just a fluent word like 'banana'?)
        """
        start_t = onset_times[start_idx]
        end_t = onset_times[start_idx + count]
        
        # ─── CHECK 1: PHONETIC VARIANCE ───
        sounds_in_cluster = []
        for k in range(count + 1):
            t_point = onset_times[start_idx + k]
            s = self._lookup_sound_at_time(t_point, t_point + 0.15, phones)
            if s and s != "?":
                sounds_in_cluster.append(s)
        
        if not sounds_in_cluster: return

        # Similarity Check
        counts = Counter(sounds_in_cluster)
        dominant_sound, _ = counts.most_common(1)[0]
        similar_count = sum(1 for s in sounds_in_cluster if is_stutter_variant(dominant_sound, s))
        
        # Strict Threshold: 75% similarity required (Prevents b-n-n from passing)
        similarity_ratio = similar_count / len(sounds_in_cluster)
        if similarity_ratio < 0.75:
            logger.info(f"🗑️ Discarded fluent cluster (Low Similarity: {sounds_in_cluster})")
            return

        # ─── CHECK 2: THE FLUENT WORD GUARD ───
        # If the cluster overlaps significantly with a single fluent word, discard it.
        # Stutters add time; fluent syllables fit inside the word.
        
        for w in words:
            # Intersection
            overlap_start = max(start_t, w.start)
            overlap_end = min(end_t, w.end)
            overlap_len = max(0, overlap_end - overlap_start)
            
            cluster_len = end_t - start_t
            
            # If the cluster is basically just the word (overlap > 80% of cluster or word)
            # AND the dominant sound is actually part of that word (e.g. 'n' in 'banana')
            if overlap_len > 0 and cluster_len > 0:
                coverage = overlap_len / cluster_len
                if coverage > 0.8:
                     logger.info(f"🗑️ Discarded fluent cluster (Just the word '{w.word}')")
                     return

        # ✅ Passed Checks
        events_list.append(RepetitionEvent(
            type="SignalRepetition",
            unit=dominant_sound,
            count=count + 1,
            start=start_t,
            end=end_t,
            confidence=0.80
        ))

    def _lookup_sound_at_time(self, start: float, end: float, phones: List[Dict]) -> str:
        candidates = []
        for p in phones:
            if (p['start'] < end) and (p['end'] > start):
                candidates.append(p['phone'])
        
        if not candidates: return "?"
        
        # Filter out generic filler vowels if we have other options
        consonants = [c for c in candidates if get_phone_class(c) != "VOWEL"]
        if consonants:
            return Counter(consonants).most_common(1)[0][0]
        
        return Counter(candidates).most_common(1)[0][0]

    # ══════════════════════════════════════════════════════════════════════
    # FUSION LOGIC
    # ══════════════════════════════════════════════════════════════════════

    def _fuse_signal_and_ai(self, sound_evs: List[RepetitionEvent], signal_evs: List[RepetitionEvent]) -> List[RepetitionEvent]:
        final_events = list(sound_evs)
        
        for sig in signal_evs:
            matched = False
            for snd in final_events:
                if (sig.start < snd.end + 0.25) and (sig.end > snd.start - 0.25):
                    # Only confirm if sounds are somewhat related
                    if is_stutter_variant(sig.unit, snd.unit):
                        logger.info(f"✅ FUSION: Signal '{sig.unit}' confirmed AI '{snd.unit}'")
                        snd.confidence = min(1.0, snd.confidence + 0.20)
                        if sig.count > snd.count:
                            snd.count = sig.count
                            snd.end = max(snd.end, sig.end)
                    matched = True # Matched temporally
                    break
            
            if not matched:
                if sig.unit != "?":
                    logger.info(f"🚀 RESCUE: Signal found missed stutter '{sig.unit}'")
                    final_events.append(sig)
        
        return final_events

    # ══════════════════════════════════════════════════════════════════════
    # TIER 1: WORD REPETITIONS
    # ══════════════════════════════════════════════════════════════════════
    
    def _detect_word_repetitions(self, words: List[Word]) -> List[RepetitionEvent]:
        events = []
        n = len(words)
        i = 0
        while i < n - 1:
            curr_w = words[i]
            burst = [curr_w]
            for j in range(i + 1, n):
                next_w = words[j]
                if curr_w.word != next_w.word: break
                if next_w.start - burst[-1].end > self.MAX_GAP_WORDS: break
                burst.append(next_w)
            
            if len(burst) > 1:
                events.append(RepetitionEvent(
                    type="WordRepetition",
                    unit=curr_w.word,
                    count=len(burst),
                    start=burst[0].start,
                    end=burst[-1].end,
                    confidence=0.98,
                    word_context=curr_w.word
                ))
                i += len(burst)
            else:
                i += 1
        return events

    # ══════════════════════════════════════════════════════════════════════
    # TIER 2: SYLLABLE REPETITIONS
    # ══════════════════════════════════════════════════════════════════════

    def _detect_syllable_repetitions(self, phones: List[Dict]) -> List[RepetitionEvent]:
        events = []
        n = len(phones)
        if n < 4: return []
        skip_indices = set()
        
        for win_len in [3, 2]:
            i = 0
            while i < n - (win_len * 2):
                if i in skip_indices: 
                    i += 1; continue
                
                seq_a = phones[i : i+win_len]
                best_match_idx = -1
                candidates = [i + win_len]
                if i + win_len + 1 < n: candidates.append(i + win_len + 1)

                for c_idx in candidates:
                     if c_idx + win_len <= n:
                        if self._are_sequences_similar(seq_a, phones[c_idx : c_idx+win_len]):
                            best_match_idx = c_idx
                            break
                
                if best_match_idx != -1:
                    seq_b = phones[best_match_idx : best_match_idx+win_len]
                    unit_text = "".join([p['phone'] for p in seq_a])
                    events.append(RepetitionEvent(
                        type="SyllableRepetition",
                        unit=unit_text,
                        count=2,
                        start=seq_a[0]['start'],
                        end=seq_b[-1]['end'],
                        confidence=0.85
                    ))
                    for k in range(i, best_match_idx + win_len): skip_indices.add(k)
                    i = best_match_idx + win_len
                else:
                    i += 1
        return events

    def _are_sequences_similar(self, seq1: List[Dict], seq2: List[Dict]) -> bool:
        if len(seq1) != len(seq2): return False
        for p1, p2 in zip(seq1, seq2):
            if not is_stutter_variant(p1['phone'], p2['phone']): return False
        if seq2[0]['start'] - seq1[-1]['end'] > self.MAX_GAP_PHONES: return False
        return True

    # ══════════════════════════════════════════════════════════════════════
    # TIER 3: SOUND REPETITIONS
    # ══════════════════════════════════════════════════════════════════════

    def _detect_sound_repetitions(self, phones: List[Dict]) -> List[RepetitionEvent]:
        events = []
        n = len(phones)
        i = 0
        while i < n - 1:
            curr = phones[i]
            if get_phone_class(curr['phone']) == 'VOWEL':
                i += 1; continue
                
            burst = [curr]
            j = i + 1
            while j < n:
                candidate = phones[j]
                gap = candidate['start'] - burst[-1]['end']
                
                match = False
                if is_stutter_variant(curr['phone'], candidate['phone']) and gap < self.MAX_GAP_PHONES:
                    match = True
                    burst.append(candidate)
                    j += 1
                elif j + 1 < n:
                    # Lookahead 1 for noise
                    next_c = phones[j+1]
                    if is_stutter_variant(curr['phone'], next_c['phone']):
                        noise_dur = candidate['end'] - candidate['start']
                        if noise_dur < 0.15:
                            burst.append(next_c)
                            j += 2
                            match = True
                
                if not match: break
                
            if len(burst) >= 2:
                events.append(RepetitionEvent(
                    type="SoundRepetition",
                    unit=curr['phone'],
                    count=len(burst),
                    start=burst[0]['start'],
                    end=burst[-1]['end'],
                    confidence=0.9
                ))
                i = j 
            else:
                i += 1
        return events

    # ══════════════════════════════════════════════════════════════════════
    # UTILITIES
    # ══════════════════════════════════════════════════════════════════════

    def _resolve_overlaps(self, events: List[RepetitionEvent]) -> List[RepetitionEvent]:
        if not events: return []
        # Sort by duration desc to keep largest unit
        events.sort(key=lambda x: (x.end - x.start), reverse=True)
        kept = []
        for e in events:
            is_covered = False
            for k in kept:
                if (e.start >= k.start - 0.05) and (e.end <= k.end + 0.05):
                    is_covered = True
                    break
            if not is_covered: kept.append(e)
        return sorted(kept, key=lambda x: x.start)

    def _find_word_context(self, start: float, end: float, words: List[Word]) -> str:
        # 1. Lookahead
        closest_next = None
        min_dist = 100.0
        for w in words:
            gap = w.start - end
            if -0.1 <= gap <= 0.6:
                if gap < min_dist:
                    min_dist = gap
                    closest_next = w.word
        if closest_next: return closest_next
        
        # 2. Overlap
        for w in words:
            if (start < w.end and end > w.start): return w.word
        return "unknown"

def get_repetition_detector() -> RepetitionDetector:
    return RepetitionDetector()