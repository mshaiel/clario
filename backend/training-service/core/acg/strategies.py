import re
import json
import random
from typing import List, Dict, Any
from config import FORMAT_ITEM_COUNTS, DEFAULT_FORMAT_ITEM_COUNT
from .syllabifier import smart_syllabify

class StrategyHandler:
    def __init__(self, miner, llm):
        self.miner = miner
        self.llm = llm
        # Tags must match those actually present in clario.db
        self.semantic_categories = ["Food", "Animal", "Body", "Action", "Color", "Family", "General"]

    def _format_target(self, fmt: str) -> int:
        return int(FORMAT_ITEM_COUNTS.get(fmt, DEFAULT_FORMAT_ITEM_COUNT))

    def _mock_word(self, target_phoneme: str, idx: int, pos: Any = None, syllables: int = 1,
                   tag: str = None, structure: str = None) -> Dict[str, Any]:
        if isinstance(pos, list) and pos:
            pos_val = pos[0]
        elif isinstance(pos, str):
            pos_val = pos
        else:
            pos_val = "Noun"

        return {
            "word": f"mock_{target_phoneme}_{idx}",
            "ipa": f"{target_phoneme} ə",
            "syllables": syllables or 1,
            "pos": pos_val,
            "tags": tag or "General",
            "structure": structure or "CVC",
            "is_mock": True,
        }

    def _extend_unique_words(self, base: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = {w.get("word") for w in base if w.get("word")}
        for w in extra:
            word = w.get("word")
            if not word or word in seen:
                continue
            base.append(w)
            seen.add(word)
        return base

    def _fetch_words_target(self, target_phoneme: str, language: str, difficulty: int,
                            structure: str = None, pos: Any = None, count: int = 5,
                            min_syllables: int = None, strict: bool = True,
                            onset_type: str = None, phoneme_position: str = "initial",
                            tag: str = None, forbidden: List[str] = None) -> List[Dict[str, Any]]:
        words = self.miner.fetch_words(
            target_phoneme=target_phoneme,
            language=language,
            difficulty=difficulty,
            structure=structure,
            pos=pos,
            count=count,
            min_syllables=min_syllables,
            strict=strict,
            onset_type=onset_type,
            phoneme_position=phoneme_position,
            tag=tag,
            forbidden_phonemes=forbidden,
        )

        if len(words) >= count:
            return words[:count]

        remaining = count - len(words)
        extra = self.miner.fetch_words(
            target_phoneme=target_phoneme,
            language=language,
            difficulty=difficulty,
            structure=structure,
            pos=pos,
            count=remaining,
            min_syllables=min_syllables,
            strict=False,
            onset_type=onset_type,
            phoneme_position=phoneme_position,
            tag=tag,
            forbidden_phonemes=forbidden,
        )
        self._extend_unique_words(words, extra)

        if len(words) >= count:
            return words[:count]

        remaining = count - len(words)
        extra = self.miner.fetch_words(
            target_phoneme=target_phoneme,
            language=language,
            difficulty=difficulty,
            count=remaining,
            strict=False,
            phoneme_position=phoneme_position,
            forbidden_phonemes=forbidden,
        )
        self._extend_unique_words(words, extra)

        if len(words) < count:
            idx = len(words) + 1
            while len(words) < count:
                words.append(self._mock_word(
                    target_phoneme,
                    idx,
                    pos=pos,
                    syllables=min_syllables or 1,
                    tag=tag,
                    structure=structure,
                ))
                idx += 1

        return words[:count]

    # ==========================================================================
    # HELPER: SYLLABIFICATION ALGORITHM (Offline & "Perfect")
    # ==========================================================================
    def _smart_syllabify(self, word: str, syllable_count: int) -> List[str]:
        """
        Uses robust, layered syllabification strategy (CMU -> Affix -> MOP -> Equal).
        """
        return smart_syllabify(word, syllable_count)

    # ==========================================================================
    # HELPER: CLINICAL TRANSLATION
    # ==========================================================================
    def _get_clinical_constraints(self, diagnosis: str, targets: List[str], position_idx: int = 0) -> Dict[str, Any]:
        diag = diagnosis.lower()
        
        positions = ["initial", "medial", "final"]
        target_pos = positions[position_idx] if 0 <= position_idx < 3 else "initial"
        
        constraints = {"onset_type": None, "phoneme_position": target_pos}

        if "cluster" in diag:
            constraints["onset_type"] = "Cluster"
        elif "block" in diag:
            constraints["onset_type"] = "Vowel"
        
        return constraints

    def _determine_foil(self, impediment: str, target: str) -> str:
        imp = impediment.lower()
        
        _STOPPING_FOILS = {
            'f': 'p',  'v': 'b',
            's': 't',  'z': 'd',
            'ʃ': 't',  'ʒ': 'd',
            'sh': 't', 'zh': 'd',
            'θ': 't',  'ð': 'd',
            'th': 't',
            'tʃ': 'p', 'dʒ': 'b',
            'ch': 'p', 'j': 'b',
            'h': 'p',
        }
        _FRONTING_FOILS  = {'k': 't', 'g': 'd', 'ŋ': 'n', 'ng': 'n'}
        _GLIDING_FOILS   = {'l': 'w', 'r': 'w'}
        
        if "fronting" in imp: return _FRONTING_FOILS.get(target, 't')
        if "stopping" in imp: return _STOPPING_FOILS.get(target, 'p')
        if "gliding" in imp: return _GLIDING_FOILS.get(target, 'w')
        if "backing" in imp: return 'k' if target in ('t', 'd') else 'g'
        
        # Default: voiced → voiced stop, voiceless → voiceless stop
        voiced = set('bdgvzʒðŋmnlrwj')
        return 'b' if target in voiced else 'p'

    def _find_indices(self, text: str, word: str) -> List[List[int]]:
        indices = []
        try:
            for m in re.finditer(rf"(?i)\b{re.escape(word)}\b", text):
                indices.append([m.start(), m.end()])
        except: pass
        return indices

    def _infer_production_mode(self, difficulty: int, diagnosis: str = "") -> str:
        diag = diagnosis.lower()
        if any(x in diag for x in ["apraxia", "cas", "dysarthria"]):
            return "imitation"
        if any(x in diag for x in ["stutter", "block", "prolong", "repetition"]):
            return "elicited"
            
        if difficulty <= 2:
            return "imitation"
        if difficulty <= 4:
            return "elicited"
        return "spontaneous"

    def _default_success_criteria(self, difficulty: int, fmt: str = "") -> Dict[str, Any]:
        _FORMAT_CRITERIA = {
            "Phoneme_Isolation": {"accuracy_threshold": 0.80, "consecutive_trials": 3},
            "Minimal_Pairs":     {"accuracy_threshold": 0.75, "consecutive_trials": 2},
            "Syllable_Chaining": {"accuracy_threshold": 0.80, "consecutive_trials": 3},
            "Speed_Drills":      {"accuracy_threshold": 0.80, "consecutive_trials": 5},
            "Shadowing":         {"accuracy_threshold": 0.70, "consecutive_trials": 2},
            "Sentences":         {"accuracy_threshold": 0.75, "consecutive_trials": 2},
        }
        base = _FORMAT_CRITERIA.get(fmt, {"accuracy_threshold": 0.80, "consecutive_trials": 3})
        if difficulty > 3:
            base = {**base, "accuracy_threshold": min(base["accuracy_threshold"] + 0.05, 0.95)}
        return base

    def _find_ipa_span(self, ipa: str, target: str, from_end: bool = False) -> List[int]:
        tokens = [p for p in str(ipa or "").split() if p]
        needle = str(target or "").lower().strip()
        matches = [i for i, t in enumerate(tokens) if t.lower() == needle]
        if not matches:
            return [0, 0]
        i = matches[-1] if from_end else matches[0]
        return [i, i]

    def _make_nonsense_bridge(self, ipa: str, position: str) -> str:
        parts = [p for p in str(ipa or "").split() if p]
        if not parts:
            return ""
        if position == "final":
            selected = parts[-2:] if len(parts) >= 2 else parts[-1:]
        else:
            selected = parts[:2] if len(parts) >= 2 else parts[:1]
        return " ".join(selected)

    def _phonemic_chunks(self, ipa: str, syllable_count: int) -> List[str]:
        """
        Split IPA phones into one chunk per syllable using vowel-nucleus detection.

        Vowel nuclei are identified by looking for phones that contain an IPA
        vowel symbol.  The algorithm groups each nucleus with its surrounding
        onset/coda consonants by placing cut-points in the middle of the
        inter-nucleus consonant cluster (MOP approximation).

        Falls back to equal phone-count division when nucleus detection fails.
        """
        phones = [p for p in str(ipa or '').split() if p]
        if not phones:
            return []
        if syllable_count <= 1:
            return [' '.join(phones)]

        # IPA symbols that indicate a vowel nucleus (broad coverage)
        IPA_VOWELS = set('aeiouæɑɒɔəɛɪɯɵʊʌʏɐɜɞɨ')

        # Find indices of vowel-bearing phones
        raw_nucleus_idx = [
            i for i, p in enumerate(phones)
            if any(v in p for v in IPA_VOWELS)
        ]

        # Merge adjacent vowel indices (diphthongs/triphthongs) into a single nucleus
        nucleus_idx = []
        for idx in raw_nucleus_idx:
            if not nucleus_idx or idx != nucleus_idx[-1] + 1:
                nucleus_idx.append(idx)

        if len(nucleus_idx) >= syllable_count:
            # Select `syllable_count` evenly spaced nuclei
            step = len(nucleus_idx) / syllable_count
            selected = [nucleus_idx[int(i * step)] for i in range(syllable_count)]

            # Build chunks: cut midway between consecutive selected nuclei
            chunks: List[str] = []
            last = 0
            for k in range(len(selected) - 1):
                v_curr = selected[k]
                v_next = selected[k + 1]
                # Gap phones between current and next nucleus
                gap_start = v_curr + 1
                gap_len = v_next - gap_start
                # MOP: give roughly half the gap to each side
                cut = gap_start + max(0, gap_len // 2)
                cut = max(last + 1, min(cut, len(phones) - 1))
                chunks.append(' '.join(phones[last:cut]))
                last = cut
            chunks.append(' '.join(phones[last:]))

            if len(chunks) == syllable_count and all(chunks):
                return chunks

        # Fallback: equal phone-count division
        k, m = divmod(len(phones), syllable_count)
        chunks = []
        start = 0
        for i in range(syllable_count):
            step = k + (1 if i < m else 0)
            end = min(start + max(1, step), len(phones))
            chunks.append(' '.join(phones[start:end]))
            start = end
            if start >= len(phones):
                break
        if start < len(phones) and chunks:
            chunks[-1] = f"{chunks[-1]} {' '.join(phones[start:])}".strip()
        return chunks

    def _stress_pattern(self, syllable_count: int, ipa: str = '') -> str:
        """
        Derive stress pattern from IPA stress markers if present.

        IPA conventions used:
          ˈ  (U+02C8) → primary stress  → 'S'
          ˌ  (U+02CC) → secondary stress → 'S' (treated same as primary for display)

        Falls back to first-syllable stress when no markers are found.
        """
        if syllable_count <= 1:
            return 'S'

        if ipa:
            phones = str(ipa).split()
            IPA_VOWELS = set('aeiouæɑɒɔəɛɪɯɵʊʌʏɐɜɞɨ')
            pattern = []
            stressed = False   # whether the NEXT vowel-bearing phone is stressed
            for p in phones:
                if p in ('ˈ', 'ˌ'):
                    stressed = True
                    continue
                if any(v in p for v in IPA_VOWELS):
                    pattern.append('S' if stressed else 'W')
                    stressed = False
            if pattern and len(pattern) == syllable_count:
                # Guarantee at least one 'S'
                if 'S' not in pattern:
                    pattern[0] = 'S'
                return ''.join(pattern)

        # Default: first syllable stressed
        return 'S' + ('W' * (syllable_count - 1))

    def _clinical_purpose(self, diagnosis: str) -> str:
        d = diagnosis.lower()
        if any(x in d for x in ["block", "prolong", "repetition"]):
            return "fluency"
        return "articulation"

    def _fluency_technique(self, diagnosis: str) -> str:
        d = diagnosis.lower()
        if "block" in d:
            return "easy_onset"
        if "prolong" in d:
            return "prolonged_speech"
        if "repetition" in d:
            return "light_contact"
        return "easy_onset"

    def _target_word_index(self, sentence: str, word: str) -> int:
        tokens = [re.sub(r"[^\w\u0600-\u06FF]", "", t).lower() for t in sentence.split()]
        needle = re.sub(r"[^\w\u0600-\u06FF]", "", word).lower()
        for i, tok in enumerate(tokens):
            if tok == needle:
                return i
        return -1

    def _sentence_ipa_proxy(self, sentence: str, fluency_targets: List[Dict[str, Any]]) -> str:
        if not sentence:
            return ""
        target_by_idx = {t["word_index"]: t["ipa"] for t in fluency_targets if t.get("word_index", -1) >= 0}
        tokens = sentence.split()
        ipa_tokens: List[str] = []
        for i, tok in enumerate(tokens):
            if i in target_by_idx:
                ipa_tokens.append(str(target_by_idx[i]))
            else:
                ipa_tokens.append(re.sub(r"[^\w\u0600-\u06FF]", "", tok).lower())
        return " ".join([t for t in ipa_tokens if t])

    # ==========================================================================
    # FORMAT HANDLERS (Optimized: 3 Items Max, Minimized API Calls)
    # ==========================================================================
    
    async def auditory_bombardment(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Auditory_Bombardment")
        target_count = self._format_target("Auditory_Bombardment")
        
        # Clinical Override for Blocking
        effective_target = t
        if cons['onset_type'] == 'Vowel':
            pass # Use generic vowel logic if needed

        words = self._fetch_words_target(
            target_phoneme=effective_target,
            language=lang,
            difficulty=diff,
            structure=struct,
            pos="Noun",
            count=target_count,
            onset_type=cons['onset_type'],
            phoneme_position=cons['phoneme_position'],
            forbidden=forbidden,
        )
        
        # Fallback for Blocking
        if not words and cons['onset_type'] == 'Vowel':
            words = self._fetch_words_target(
                target_phoneme='a',
                language=lang,
                difficulty=1,
                count=target_count,
                onset_type='Vowel',
                forbidden=forbidden,
            )

        items = []
        for w in words:
            items.append({
                "word": w['word'],
                "ipa": w['ipa'],
                "metadata": {"category": w.get('tags', 'General'), "syllables": w['syllables']},
                "production_mode": production_mode,
            })
        return {
            "format": "Auditory_Bombardment",
            "target_phoneme": t,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def phoneme_isolation(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Phoneme_Isolation")
        total_count = self._format_target("Phoneme_Isolation")
        init_count = (total_count + 1) // 2
        final_count = total_count - init_count
        
        words_init = self._fetch_words_target(
            t, lang, diff, struct, count=init_count,
            onset_type=cons['onset_type'],
            phoneme_position="initial",
            forbidden=forbidden,
        )
        words_final = []
        if final_count > 0:
            words_final = self._fetch_words_target(
                t, lang, diff, struct, count=final_count,
                phoneme_position="final",
                forbidden=forbidden,
            )
        
        items = []
        for w in words_init:
            bridge_ipa = self._make_nonsense_bridge(w['ipa'], "initial")
            items.append({
                "word": w['word'],
                "ipa": w['ipa'],
                "position": "initial",
                "highlight_ipa_indices": self._find_ipa_span(w['ipa'], t, from_end=False),
                "nonsense_bridge": bridge_ipa.replace(" ", ""),
                "nonsense_ipa": bridge_ipa,
                "production_mode": production_mode,
            })
        for w in words_final:
             bridge_ipa = self._make_nonsense_bridge(w['ipa'], "final")
             items.append({
                 "word": w['word'],
                 "ipa": w['ipa'],
                 "position": "final",
                 "highlight_ipa_indices": self._find_ipa_span(w['ipa'], t, from_end=True),
                 "nonsense_bridge": bridge_ipa.replace(" ", ""),
                 "nonsense_ipa": bridge_ipa,
                 "production_mode": production_mode,
             })
        
        return {
            "format": "Phoneme_Isolation",
            "target_phoneme": t,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def minimal_pairs(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        t = targets[0]
        foil_sound = self._determine_foil(diag, t)
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Minimal_Pairs")
        target_count = self._format_target("Minimal_Pairs")
        
        target_words = self._fetch_words_target(
            t, lang, diff, struct, count=target_count * 3,
            onset_type=cons['onset_type'],
            phoneme_position=cons['phoneme_position'],
            forbidden=forbidden,
        )
        
        pairs = []
        seen_targets = set()
        for tw in target_words:
            if len(pairs) >= target_count:
                break
            word = tw.get('word')
            if not word or word in seen_targets:
                continue
            seen_targets.add(word)
            foil_row = self.miner.fetch_minimal_pair_foil(tw, foil_sound, lang, diff)
            if foil_row:
                pairs.append({
                    "target": {"word": tw['word'], "ipa": tw['ipa'], "sem_tag": tw.get('tags', '')},
                    "foil": {"word": foil_row['word'], "ipa": foil_row['ipa'], "sem_tag": foil_row.get('tags', '')}
                })

        if len(pairs) < target_count:
            relaxed_words = self._fetch_words_target(
                t, lang, diff, structure=None, count=target_count * 2,
                phoneme_position=cons['phoneme_position'],
                forbidden=forbidden,
                strict=False,
            )
            for tw in relaxed_words:
                if len(pairs) >= target_count:
                    break
                word = tw.get('word')
                if not word or word in seen_targets:
                    continue
                seen_targets.add(word)
                foil_row = self.miner.fetch_minimal_pair_foil(tw, foil_sound, lang, diff)
                if foil_row:
                    pairs.append({
                        "target": {"word": tw['word'], "ipa": tw['ipa'], "sem_tag": tw.get('tags', '')},
                        "foil": {"word": foil_row['word'], "ipa": foil_row['ipa'], "sem_tag": foil_row.get('tags', '')}
                    })

        if len(pairs) < target_count:
            idx = len(pairs) + 1
            while len(pairs) < target_count:
                mock_target = self._mock_word(t, idx, pos="Noun", syllables=1, tag="General", structure=struct)
                mock_foil = self._mock_word(foil_sound, idx, pos="Noun", syllables=1, tag="General", structure=struct)
                pairs.append({
                    "target": {"word": mock_target['word'], "ipa": mock_target['ipa'], "sem_tag": mock_target.get('tags', '')},
                    "foil": {"word": mock_foil['word'], "ipa": mock_foil['ipa'], "sem_tag": mock_foil.get('tags', '')}
                })
                idx += 1
        return {
            "format": "Minimal_Pairs",
            "contrast": f"{t} vs {foil_sound}",
            "task_type": "discrimination",
            "picture_support": True,
            "pairs": pairs,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def syllable_chaining(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        """
        NO LLM CALLS. Uses algorithmic splitter.
        """
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Syllable_Chaining")

        # Bug 12 fix: use difficulty to determine direction in addition to diagnosis.
        # Backward chaining is easier (child always ends on the complete word),
        # so use it for low-difficulty levels and epenthesis regardless of level.
        if "epenthesis" in diag.lower() or diff <= 2:
            chaining_direction = "backward"
        else:
            chaining_direction = "forward"

        target_count = self._format_target("Syllable_Chaining")
        
        words = self._fetch_words_target(
            t, lang, diff, structure="Complex", count=target_count,
            min_syllables=2,
            onset_type=cons['onset_type'], phoneme_position=cons['phoneme_position'], forbidden=forbidden
        )
        
        items = []
        for w in words:
            txt, syl = w['word'], w['syllables']
            # Bug 9 fix: improved syllabifier (MOP-based)
            chunks = self._smart_syllabify(txt, syl)
            
            items.append({
                "word": txt,
                "ipa": w['ipa'],
                "syllable_count": syl,
                # Bug 11 fix: pass IPA so stress pattern is derived from markers
                "stress_pattern": self._stress_pattern(syl, w.get('ipa', '')),
                # Bug 10 fix: vowel-nucleus aware phonemic chunking
                "phonemic_chunks": self._phonemic_chunks(w['ipa'], syl),
                "visual_chunks": chunks,
                "production_mode": production_mode,
            })
        return {
            "format": "Syllable_Chaining",
            "chaining_direction": chaining_direction,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def sentences(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        """
        USES LLM. One request per level.
        """
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        target_count = self._format_target("Sentences")
        
        words_data = self._fetch_words_target(
            t, lang, diff, struct, count=target_count,
            onset_type=cons['onset_type'],
            phoneme_position=cons['phoneme_position'], forbidden=forbidden
        )
        
        # Metadata List for LLM/Offline Fallback
        # Pass 'pos' so offline engine knows grammar rules
        llm_input = [{"word": w['word'], "tag": w.get('tags', 'General'), "pos": w.get('pos', 'Noun')} for w in words_data]
        
        # Single Batch Request
        sent_map = await self.llm.generate_sentences(llm_input, lang)
        
        items = []
        for w in words_data:
            txt = w['word']
            sent = sent_map.get(txt, f"{txt}.") 
            indices = self._find_indices(sent, txt)
            items.append({
                "display_text": sent,
                "target_metadata": {"word": txt, "ipa": w['ipa'], "indices": indices[0] if indices else []}
            })
        return {"format": "Sentences", "items": items}

    async def carrier_phrases(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        """
        USES LLM. One request per level.
        """
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        selected_tag = random.choice(self.semantic_categories)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Carrier_Phrases")
        clinical_purpose = self._clinical_purpose(diag)
        fluency_technique = self._fluency_technique(diag)
        target_count = self._format_target("Carrier_Phrases")
        
        words = self._fetch_words_target(
            t, lang, diff, struct, pos="Noun", count=target_count,
            onset_type=cons['onset_type'],
            phoneme_position=cons['phoneme_position'], tag=selected_tag, forbidden=forbidden
        )
        if not words:
             words = self._fetch_words_target(
                t, lang, diff, struct, pos="Noun", count=target_count,
                onset_type=cons['onset_type'], forbidden=forbidden
            )
             selected_tag = "General"
        
        frames = await self.llm.generate_carrier_phrases(selected_tag, lang)
        
        items = []
        for i, w in enumerate(words):
            frame = frames[i % len(frames)]
            full_sent = frame.replace("____", w['word'])
            items.append({
                "target_word": w['word'], "target_ipa": w['ipa'], "full_sentence": full_sent,
                "target_word_index": self._target_word_index(full_sent, w['word']),
                "category": w.get('tags', 'General'),
                "production_mode": production_mode,
            })
        return {
            "format": "Carrier_Phrases",
            "carrier_frame": frames[0],
            "clinical_purpose": clinical_purpose,
            "fluency_technique": fluency_technique,
            "category_theme": selected_tag,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def pacing(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        """
        NO LLM CALLS. Strictly offline rhythmic word fetch.
        """
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Pacing")
        is_fluency = self._clinical_purpose(diag) == "fluency"
        technique = "syllable_timed" if is_fluency else "metronome"
        pacing_unit = "syllable"
        baseline_rate_wpm = 180 if is_fluency else 140
        target_rate_wpm = max(80, baseline_rate_wpm - (50 - (diff * 5)))
        beats_per_minute = 60 if is_fluency else 72
        target_count = self._format_target("Pacing")
        
        if cons['onset_type'] == 'Vowel':
            words = self._fetch_words_target(
                t, lang, diff, struct, count=target_count, min_syllables=1, onset_type='Vowel', forbidden=forbidden
            )
            if not words:
                words = self._fetch_words_target(
                    'a', lang, diff, struct, count=target_count, min_syllables=1, onset_type='Vowel', forbidden=forbidden
                )
        else:
            words = self._fetch_words_target(
                t, lang, diff, struct, count=target_count, min_syllables=1,
                onset_type=cons['onset_type'], phoneme_position=cons['phoneme_position'], forbidden=forbidden
            )
        
        items = []
        for w in words:
            items.append({
                "word": w['word'],
                "ipa": w['ipa'],
                "syllable_count": w['syllables'],
                "is_ideal": w['syllables'] == 1,
                "production_mode": production_mode,
            })

        return {
            "format": "Pacing",
            "target_phoneme": t,
            "technique": technique,
            "pacing_unit": pacing_unit,
            "beats_per_minute": beats_per_minute,
            "baseline_rate_wpm": baseline_rate_wpm,
            "target_rate_wpm": target_rate_wpm,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def shadowing(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        """
        USES LLM. Focuses on utterance-level fluency targets.
        """
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Shadowing")
        model_speech_rate_wpm = 120
        target_count = self._format_target("Shadowing")

        words_data = self._fetch_words_target(
            t, lang, diff, struct, count=target_count,
            onset_type=cons['onset_type'],
            phoneme_position=cons['phoneme_position'], forbidden=forbidden
        )
        llm_input = [{"word": w['word'], "tag": w.get('tags', 'General'), "pos": w.get('pos', 'Noun')} for w in words_data]
        sent_map = await self.llm.generate_sentences(llm_input, lang)

        items = []
        for w in words_data:
            sent = sent_map.get(w['word'], f"{w['word']}.")
            fluency_targets = []
            idx = self._target_word_index(sent, w['word'])
            if idx >= 0:
                fluency_targets.append({
                    "word": w['word'],
                    "word_index": idx,
                    "ipa": w['ipa'],
                })

            items.append({
                "display_text": sent,
                "sentence_ipa": self._sentence_ipa_proxy(sent, fluency_targets),
                "fluency_targets": fluency_targets,
                "production_mode": production_mode,
            })

        return {
            "format": "Shadowing",
            "model_speech_rate_wpm": model_speech_rate_wpm,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }

    async def speed_drills(self, targets, diag, lang, diff, struct, forbidden, position_idx):
        """
        NO LLM CALLS.
        """
        t = targets[0]
        cons = self._get_clinical_constraints(diag, targets, position_idx)
        production_mode = self._infer_production_mode(diff, diag)
        success_criteria = self._default_success_criteria(diff, "Speed_Drills")
        baseline_rate_wpm = 60
        target_rate_wpm = 120
        accuracy_threshold = 0.80
        drill_duration_seconds = 30
        rest_interval_seconds = 15
        target_count = self._format_target("Speed_Drills")
        
        words = self._fetch_words_target(
            t, lang, difficulty=1, structure="CV", count=target_count,
            onset_type=cons['onset_type'],
            phoneme_position=cons['phoneme_position'], forbidden=forbidden, strict=True
        )
        if not words:
            words = self._fetch_words_target(
                t, lang, difficulty=1, structure="CVC", count=target_count,
                forbidden=forbidden, strict=False
            )
        items = []
        for w in words:
            items.append({
                "word": w['word'],
                "ipa": w['ipa'],
                "syllable_count": w.get('syllables', 1),
                "production_mode": production_mode,
            })
        return {
            "format": "Speed_Drills",
            "target_phoneme": t,
            "baseline_rate_wpm": baseline_rate_wpm,
            "target_rate_wpm": target_rate_wpm,
            "accuracy_threshold": accuracy_threshold,
            "drill_duration_seconds": drill_duration_seconds,
            "rest_interval_seconds": rest_interval_seconds,
            "items": items,
            "production_mode": production_mode,
            "success_criteria": success_criteria,
        }