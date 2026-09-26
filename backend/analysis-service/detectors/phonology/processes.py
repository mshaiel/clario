import logging
from typing import Dict, Any, List
from core.shared_asr import ASRResult
from core.sentence_bank import SentenceEntry
from core.alignment import get_phone_class
from .core_soda import get_soda_engine, SodaEvent

logger = logging.getLogger("PhonoProcesses")

class PhonologicalProcessDetector:
    def __init__(self):
        self.soda_engine = get_soda_engine()

    def analyze(self, audio_path: str, sentence: SentenceEntry, asr_result: ASRResult, test_type: str, language: str = "english") -> Dict[str, Any]:
        """
        Main entry point.
        1. Calculates SODA errors (passing language context).
        2. Filters them based on the requested Test Type.
        3. Annotates each event with its process_name for accuracy calculation.
        """
        # 1. Get Raw SODA with Language Context
        all_soda, alignment_confidence = self.soda_engine.compute_soda(asr_result, sentence, test_type, language)
        
        # 2. Filter based on Test Type and annotate events
        detected_processes = []
        
        for event in all_soda:
            process_name = None
            
            if test_type == "velar_fronting":
                process_name = self._check_velar_fronting(event, language)
            elif test_type == "stopping":
                process_name = self._check_stopping(event, language)
            elif test_type == "gliding":
                process_name = self._check_gliding(event, language)
            elif test_type == "cluster_reduction":
                process_name = self._check_cluster_reduction(event, language)
            elif test_type == "epenthesis":
                process_name = self._check_epenthesis(event, language)
            elif test_type == "comprehensive":
                process_name = (
                    self._check_velar_fronting(event, language) or 
                    self._check_stopping(event, language) or 
                    self._check_gliding(event, language) or 
                    self._check_cluster_reduction(event, language) or 
                    self._check_epenthesis(event, language)
                )
            
            # ⭐ ANNOTATE: Store process_name in the event for accuracy calculation
            event.process_name = process_name
            
            if process_name:
                detected_processes.append({
                    "process": process_name,
                    "word": event.word,
                    "expected": event.expected,
                    "heard": event.heard,
                    "confidence": event.confidence
                })
    
        return {
            "test_type": test_type,
            "detected_count": len(detected_processes),
            "events": detected_processes,
            "raw_soda": [vars(e) for e in all_soda],
            "alignment_confidence": alignment_confidence
        }

    # ─── CLINICAL LOGIC ──────────────────────────────────────────────

    def _check_velar_fronting(self, e: SodaEvent, language: str) -> str:
        """K/G/Q (Back) -> T/D (Front)"""
        if e.type != "substitution": return None

        exp_cls = get_phone_class(e.expected, language)
        heard_cls = get_phone_class(e.heard, language)

        # STOP_K already covers velar + uvular (k, ɡ, q, x, ɣ, χ, ʁ, kʰ, ɡʰ)
        # STOP_T already covers alveolar + dental + retroflex (t, d, ʈ, ɖ, t̪, d̪ …)
        if exp_cls == "STOP_K" and heard_cls == "STOP_T":
            return "Velar Fronting"
        return None

    def _check_stopping(self, e: SodaEvent, language: str) -> str:
        """Fricative/Sibilant -> Stop"""
        if e.type != "substitution": return None

        exp_cls = get_phone_class(e.expected, language)
        heard_cls = get_phone_class(e.heard, language)

        # SIBIL_S (s, z, ʂ …) and SIBIL_SH (ʃ, ʒ) are separate from FRIC (f, v, h …)
        # STOP_K/T/P cover all stop sub-classes
        fricative_classes = ["FRIC", "SIBIL_S", "SIBIL_SH", "TH_SOUND"]
        stop_classes = ["STOP_P", "STOP_T", "STOP_K"]

        if exp_cls in fricative_classes and heard_cls in stop_classes:
            return "Stopping"
        return None

    def _check_gliding(self, e: SodaEvent, language: str) -> str:
        """Liquid (L/R) -> Glide (W/Y)"""
        if e.type != "substitution": return None
        
        exp_cls = get_phone_class(e.expected, language)
        heard_cls = get_phone_class(e.heard, language)
        
        # Standard Definition: Liquid -> Glide
        if exp_cls == "LIQUID" and heard_cls == "GLIDE":
            return "Gliding"
            
        # FIX: Catch 'v' (often classified as Fricative) acting as a Glide in Urdu
        # "Rail" -> "Vail" is Gliding in this context.
        if exp_cls == "LIQUID" and e.heard in ['v', 'ʋ', 'w', 'j']:
            return "Gliding"
            
        # Also catch Glide substitutions that get misclassified as Vowels
        if exp_cls == "LIQUID" and heard_cls == "VOWEL" and e.heard in ['w', 'j', 'ʋ']:
             return "Gliding"
             
        return None

    def _check_cluster_reduction(self, e: SodaEvent, language: str) -> str:
        """Omission of a consonant from a cluster"""
        if e.type != "omission": return None
        
        exp_cls = get_phone_class(e.expected, language)
        if exp_cls not in ["VOWEL"]: 
            return "Cluster Reduction"
        return None

    def _check_epenthesis(self, e: SodaEvent, language: str) -> str:
        """Insertion of vowel"""
        if e.type != "addition": 
            return None
        
        if get_phone_class(e.heard, language) == 'VOWEL':
            return "Epenthesis"
        return None

def get_phono_detector() -> PhonologicalProcessDetector:
    return PhonologicalProcessDetector()