"""
SODA Engine - Prototype-Style Direct Alignment
-----------------------------------------------
Aligns entire sentence's phone sequence, then filters by target words.
"""

import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from core.alignment import get_optimal_alignment, are_phones_similar, get_phone_class
from core.alignment import should_ignore_omission, should_ignore_addition
from core.sentence_bank import SentenceEntry
from core.shared_asr import ASRResult

logger = logging.getLogger("SodaEngine")

@dataclass
class SodaEvent:
    type: str           # "substitution", "omission", "addition"
    word: str           # The target word (e.g., "red")
    expected: str       # Expected phone (e.g., "ɹ")
    heard: str          # Heard phone (e.g., "w")
    position: int       # Position in the word
    confidence: float
    process_name: Optional[str] = None  # The phonological process this error represents (e.g., "Velar Fronting")

class SodaEngine:
    def __init__(self):
        pass

    def compute_soda(self, asr_result: ASRResult, sentence: SentenceEntry, test_type: str = "comprehensive", language: str = "english") -> tuple[List[SodaEvent], float]:
        """
        1. Build full expected phone sequence for entire sentence (with word tracking)
        2. Get heard phone sequence (flat list - no timing needed)
        3. Global alignment (Language Aware)
        4. Filter to only target words
        """
        
        # ─── STEP 1: Build Expected Sequence ───
        exp_data = []
        target_words_set = {t.word.lower() for t in sentence.targets}
        
        for target in sentence.targets:
            word = target.word.lower()
            phones = target.expected_ipa
            
            for i, phone in enumerate(phones):
                exp_data.append({
                    'word': word,
                    'phone': phone,
                    'is_final': (i == len(phones) - 1),
                    'is_target': True 
                })
        
        if not exp_data:
            logger.warning("No expected phones to align")
            return [], 0.0
        
        # ─── STEP 2: Get Heard Phones ───
        heard_phones = [p.phone for p in asr_result.phones]
        
        logger.info(f"Aligning ({language}): {len(exp_data)} expected vs {len(heard_phones)} heard")
        
        # ─── STEP 3: Global Alignment (Language Aware) ───
        # Pass the language flag to the alignment core
        aligned_exp, aligned_heard, alignment_confidence = get_optimal_alignment(exp_data, heard_phones, language)
        
        # ─── STEP 4: Extract Errors ───
        soda_events = []
        last_word = "unknown"
        
        for i, (exp, heard) in enumerate(zip(aligned_exp, aligned_heard)):
            if exp:
                last_word = exp['word']
            
            # ─── CASE: OMISSION ───
            if heard is None:
                if not exp.get('is_target', False): continue
                
                if should_ignore_omission(exp['phone'], exp.get('is_final', False)):
                    continue
                
                soda_events.append(SodaEvent(
                    type="omission",
                    word=exp['word'],
                    expected=exp['phone'],
                    heard="",
                    position=i,
                    confidence=alignment_confidence
                ))
            
            # ─── CASE: ADDITION ───
            elif exp is None:
                if last_word not in target_words_set: continue
                
                if should_ignore_addition(heard, test_type):
                    continue
                
                soda_events.append(SodaEvent(
                    type="addition",
                    word=last_word,
                    expected="",
                    heard=heard,
                    position=i,
                    confidence=alignment_confidence
                ))
            
            # ─── CASE: SUBSTITUTION ───
            else:
                if not exp.get('is_target', False): continue
                
                # Use Language-Aware Similarity Check
                if not are_phones_similar(exp['phone'], heard, language):
                    # Check for generic vowel swaps (usually accent)
                    if (get_phone_class(exp['phone'], language) == 'VOWEL' and 
                        get_phone_class(heard, language) == 'VOWEL'):
                        continue
                    
                    soda_events.append(SodaEvent(
                        type="substitution",
                        word=exp['word'],
                        expected=exp['phone'],
                        heard=heard,
                        position=i,
                        confidence=alignment_confidence
                    ))
        
        logger.info(f"Detected {len(soda_events)} SODA events")
        return soda_events, alignment_confidence

_soda_engine = SodaEngine()
def get_soda_engine():
    return _soda_engine