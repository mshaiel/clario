import logging
import re
from typing import Dict, Any, List
from difflib import SequenceMatcher  # <--- NEW IMPORT

from core.asr_models import get_asr_loader
from core.sentence_bank import get_sentence_bank, SentenceEntry, TargetWord
from core.shared_asr import ASRResult, Word, Phone

from detectors.fluency.blocks import get_blocks_detector
from detectors.fluency.prolongation import get_prolongation_detector
from detectors.fluency.repetition import get_repetition_detector
from detectors.phonology.processes import get_phono_detector

logger = logging.getLogger("PipelineManager")

class PipelineManager:
    def __init__(self):
        self.asr_loader = get_asr_loader()
        self.sentence_bank = get_sentence_bank()
        
        self.detectors = {
            "blocks": get_blocks_detector(),
            "prolongation": get_prolongation_detector(),
            "repetition": get_repetition_detector(),
            "phonology": get_phono_detector()
        }

    def analyze(self, audio_path: str, sentence_id: str, test_type: str, language: str = "english", targets_json: str = None) -> Dict[str, Any]:
        """
        Orchestrates the analysis pipeline.
        Now includes Transcript Generation and Accuracy Scoring.
        """
        results = {}
        errors = []

        sentence = None
        if targets_json is not None:
            import json
            try:
                targets_data = json.loads(targets_json)
                targets = [TargetWord(word=t["word"], expected_ipa=t["expected_ipa"]) for t in targets_data]
            except Exception as e:
                logger.error(f"Failed to parse targets_json: {e}")
                targets = []
            logger.info(f"Dynamically created sentence '{sentence_id}' with {len(targets)} targets.")
            sentence = SentenceEntry(id="dynamic", text=sentence_id, difficulty=1, test_type=test_type, targets=targets)
        else:
            sentence = self.sentence_bank.get_sentence(sentence_id)
            if not sentence:
                if " " in sentence_id or len(sentence_id) > 5:
                    logger.info(f"Dynamically created sentence '{sentence_id}' without targets.")
                    sentence = SentenceEntry(id="dynamic", text=sentence_id, difficulty=1, test_type=test_type, targets=[])
                else:
                    return {"success": False, "error": f"Sentence ID '{sentence_id}' not found."}

        try:
            # ⭐ OPTIMIZATION: Define test categories
            phonology_tests = {
                "velar_fronting", "stopping", "gliding", 
                "cluster_reduction", "epenthesis"
            }
            
            fluency_tests = {"blocks", "prolongation", "repetition"}
            
            # Determine tests to run
            tests_to_run = []
            has_ipa_targets = any(len(tgt.expected_ipa) > 0 for tgt in sentence.targets)
            if test_type == "comprehensive":
                if has_ipa_targets:
                    tests_to_run = [
                        "blocks", "prolongation", "repetition",
                        "velar_fronting", "stopping", "gliding",
                        "cluster_reduction", "epenthesis"
                    ]
                else:
                    # Dynamic/technique sentences have no IPA targets —
                    # phonology detectors require IPA and would score incorrectly.
                    # Run fluency detectors only; accuracy comes from word-level alignment.
                    logger.info("⚡ No IPA targets on dynamic sentence — skipping phonology detectors for comprehensive.")
                    tests_to_run = ["blocks", "prolongation", "repetition"]
            elif test_type == "phonology":
                if has_ipa_targets:
                    tests_to_run = sorted(phonology_tests)
                else:
                    logger.info("⚡ No IPA targets for phonology meta — skipping phonology detectors.")
                    tests_to_run = []
            elif test_type == "fluency":
                tests_to_run = sorted(fluency_tests)
            else:
                tests_to_run = [test_type]
            
            # ⭐ CLEAR ASR REQUIREMENTS
            needs_phonology = any(t in phonology_tests for t in tests_to_run)
            needs_fluency = any(t in fluency_tests for t in tests_to_run)
            needs_prolongation_phones = "prolongation" in tests_to_run
            needs_blocks = "blocks" in tests_to_run
            needs_repetition_phones = "repetition" in tests_to_run
            needs_words = True

            logger.info(f"Test plan: {tests_to_run} | Language: {language}")

            # ⭐ CONDITIONAL ASR CALLS
            raw_words = None
            raw_phones = None
            
            # Always need words for any test
            if needs_words:
                logger.info(f"🎤 Running ASR ({language})...")
                # ⚠️  DO NOT pass sentence.text as prompt for dynamic sentences.
                # Whisper's initial_prompt biases the decoder toward the prompt text so
                # strongly that it will hallucinate it verbatim even over silence or
                # completely wrong speech — producing 100 % accuracy scores every time.
                # Dynamic sentences come from the Techniques module (technique_targets.json
                # or the fallback builder in cam_proxy.py).  They are identified by
                # sentence.id == "dynamic".  Only real Firestore sentences get the prompt.
                asr_prompt = sentence.text if sentence.id != "dynamic" else None
                if asr_prompt is None:
                    logger.info("⚡ Dynamic sentence — suppressing Whisper prompt to prevent hallucination")
                raw_words = self.asr_loader.transcribe_words(
                    audio_path,
                    use_phonology_settings=needs_phonology or needs_prolongation_phones or needs_repetition_phones,
                    prompt=asr_prompt,
                    language=language
                )
                logger.info(f"✅ Transcribed {len(raw_words)} words")
            
            # ══════════════════════════════════════════════════════════════
            # NEW LOGIC: TRANSCRIPT & ACCURACY SCORE
            # ══════════════════════════════════════════════════════════════
            transcript_str = ""
            accuracy_score = 0.0
            
            if raw_words:
                # 1. Build Transcript
                # Whisper returns dicts, we extract the 'word' field
                transcript_str = " ".join([w['word'] for w in raw_words])
                
                logger.info(f"📝 Transcript: '{transcript_str}'")
            # ══════════════════════════════════════════════════════════════

            # ══════════════════════════════════════════════════════════════
            # WORD-LEVEL ALIGNMENT
            # ══════════════════════════════════════════════════════════════
            word_results = []
            # Strip punctuation so "string." == "string" — avoids artificial substitution penalty
            def _clean(w: str) -> str:
                return re.sub(r"[^\w\s]", "", w).strip()

            expected_words = [_clean(w) for w in sentence.text.lower().split() if _clean(w)]
            heard_words = [_clean(w) for w in transcript_str.lower().split() if _clean(w)] if transcript_str else []

            word_matcher = SequenceMatcher(None, expected_words, heard_words)
            for tag, i1, i2, j1, j2 in word_matcher.get_opcodes():
                if tag == "equal":
                    for w in expected_words[i1:i2]:
                        word_results.append({"word": w, "status": "heard", "heard_as": None})
                elif tag == "replace":
                    for idx, w in enumerate(expected_words[i1:i2]):
                        heard_as = heard_words[j1 + idx] if (j1 + idx) < j2 else None
                        word_results.append({"word": w, "status": "substituted", "heard_as": heard_as})
                elif tag == "delete":
                    for w in expected_words[i1:i2]:
                        word_results.append({"word": w, "status": "skipped", "heard_as": None})
                # "insert" = Whisper hallucinations — ignored
            logger.info(f"📊 Word alignment: {word_results}")

            # ══════════════════════════════════════════════════════════════

            # ⭐ Run Allosaurus / Wav2Vec2 for Phoneme recognition
            if needs_phonology or needs_prolongation_phones or needs_blocks or needs_repetition_phones:
                logger.info(f"🔤 Running Phoneme recognition ({language})...")
                needs_accurate_timing = needs_blocks 
                raw_phones = self.asr_loader.recognize_phones(
                    audio_path, 
                    need_accurate_timing=needs_accurate_timing,
                    language=language 
                )
                logger.info(f"✅ Recognized {len(raw_phones)} phonemes")
            else:
                logger.info("⏩ Skipping Allosaurus (not needed for current tests)")
            
            # ⭐ Build proper ASR result object
            words_list = []
            if raw_words:
                for w in raw_words:
                    words_list.append(Word(
                        word=w['word'],
                        start=w['start'],
                        end=w['end'],
                        confidence=w.get('confidence', 1.0)
                    ))
            
            phones_list = []
            if raw_phones:
                for p in raw_phones:
                    phones_list.append(Phone(
                        phone=p['phone'],
                        start=p['start'],
                        end=p['end'],
                        duration=p['duration']
                    ))
            
            asr_result = ASRResult(words=words_list, phones=phones_list)

            # Execute Tests
            for t in tests_to_run:
                try:
                    if t in fluency_tests:
                        logger.info(f"🔍 Running fluency test: {t} ({language})")
                        res = self.detectors[t].analyze(audio_path, asr_result)
                        results[t] = res
                    else:
                        logger.info(f"🔍 Running phonology test: {t} ({language})")
                        res = self.detectors["phonology"].analyze(
                            audio_path, sentence, asr_result, t, language=language
                        )
                
                        results[t] = res
                except Exception as e:
                    logger.error(f"Test '{t}' failed: {e}", exc_info=True)
                    errors.append(f"{t}: {str(e)}")

            # ══════════════════════════════════════════════════════════════
            # POST-DETECTOR ACCURACY SCORE (SODA / Error-Word based)
            # ══════════════════════════════════════════════════════════════
            if len(tests_to_run) == 1:
                t = tests_to_run[0]
                if t in phonology_tests and t in results:
                    total_phonemes = sum(len(tgt.expected_ipa) for tgt in sentence.targets)
                    
                    # ⭐ NEW LOGIC: Count only PRIMARY errors (matching the test type)
                    raw_soda_events = results[t].get("raw_soda", [])
                    primary_error_count = len([
                        e for e in raw_soda_events 
                        if e.get("process_name") and e.get("process_name").lower().replace(" ", "_") == t
                    ])
                    
                    if total_phonemes > 0:
                        accuracy_score = round(max(0.0, (total_phonemes - primary_error_count) / total_phonemes * 100), 2)
                    else:
                        accuracy_score = 0.0
                    
                    logger.info(f"🎯 Phonology accuracy (SODA): {accuracy_score}% ({total_phonemes - primary_error_count}/{total_phonemes} clean phonemes, primary {t} errors only)")
                elif t in fluency_tests and t in results:
                    events = results[t].get("events", [])
                    affected = set()
                    for ev in events:
                        w = ev.get("word") or ev.get("prev_word") or ev.get("word_context") or ""
                        cleaned = _clean(w)
                        if cleaned:
                            affected.add(cleaned.lower())
                    clean_count = sum(1 for w in expected_words if w not in affected)
                    accuracy_score = round((clean_count / len(expected_words)) * 100, 2) if expected_words else 0.0
                    logger.info(f"🎯 Fluency accuracy (error-word): {accuracy_score}% ({clean_count}/{len(expected_words)} clean words)")
                else:
                    heard_count = sum(1 for r in word_results if r["status"] == "heard")
                    accuracy_score = round((heard_count / len(expected_words)) * 100, 2) if expected_words else 0.0
                    logger.info(f"🎯 Accuracy (word-level fallback): {accuracy_score}%")
            else:
                # Comprehensive: word-level alignment
                heard_count = sum(1 for r in word_results if r["status"] == "heard")
                accuracy_score = round((heard_count / len(expected_words)) * 100, 2) if expected_words else 0.0
                logger.info(f"🎯 Accuracy (comprehensive, word-level): {accuracy_score}%")



            return {
                "success": True,
                "sentence_id": sentence_id,
                "text": sentence.text,
                "transcript": transcript_str,       # <--- Return Transcript
                "accuracy_score": accuracy_score,   # <--- Return Score
                "word_results": word_results,        # <--- Return Word Alignment
                "test_type": test_type,
                "language": language,
                "results": results,
                "errors": errors if errors else None
            }

        except Exception as e:
            logger.error(f"Pipeline Critical Failure: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

_manager = None
try:
    _manager = PipelineManager()
except Exception as _e:
    logging.getLogger("PipelineManager").critical(
        f"❌ Failed to instantiate PipelineManager at import time: {_e}", exc_info=True
    )

def get_pipeline_manager() -> PipelineManager:
    return _manager