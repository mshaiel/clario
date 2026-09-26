import json
import os
import random
import zipfile
import io
from typing import List, Dict, Any, Optional

from utils.logger import get_logger
from google.cloud import firestore as _firestore
from google.oauth2 import service_account as _sa

logger = get_logger("Recommender")


def _get_sync_db() -> _firestore.Client:
    """Return a synchronous Firestore client.
    Priority: GOOGLE_CREDENTIALS_JSON env var → key file → ADC."""
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        info = json.loads(creds_json)
        creds = _sa.Credentials.from_service_account_info(info)
        return _firestore.Client(credentials=creds, project=info.get("project_id"))
    key_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "key.json")
    if os.path.exists(key_path):
        creds = _sa.Credentials.from_service_account_file(key_path)
        return _firestore.Client(credentials=creds)
    return _firestore.Client()


# ── Hugging Face audio dataset ────────────────────────────────────────────────
HF_AUDIO_BASE = "https://huggingface.co/datasets/junaiddbz/TTS_Audios/resolve/main"


def _hf_static_lang(language: str) -> str:
    """static_tts uses 'english' / 'Urdu' (capital U) on HF."""
    return "Urdu" if language.lower() == "urdu" else "english"


def _fetch_hf_bytes(url: str) -> Optional[bytes]:
    """Fetch raw bytes from a HuggingFace dataset URL. Returns None on failure."""
    try:
        import httpx
        r = httpx.get(url, timeout=15, follow_redirects=True)
        if r.status_code == 200:
            return r.content
        logger.warning(f"⚠️ HF fetch HTTP {r.status_code}: {url}")
        return None
    except Exception as e:
        logger.warning(f"⚠️ HF fetch failed ({e}): {url}")
        return None

# Shared mapping from test-type name to data-file prefix (legacy fallback).
# Both "repetition" (singular, catalog key) and "repetitions" (plural, file name)
# are supported to avoid ID mismatches between assign_assessments and the catalog.
_TYPE_TO_FILE: Dict[str, str] = {
    "blocks": "1_blocks",
    "prolongation": "2_prolongation",
    "repetitions": "3_repetitions",
    "repetition": "3_repetitions",   # alias — catalog uses singular form
    "velar_fronting": "4_velar_fronting",
    "stopping": "5_stopping",
    "gliding": "6_gliding",
    "cluster_reduction": "7_cluster_reduction",
    "epenthesis": "8_epenthesis",
}

# Primary sentence data source: pre-generated sentence banks manifest.
_SENTENCE_BANKS_MANIFEST = "audio_assets/sentence_banks/manifest.json"

# Aliases: maps catalog singular forms to manifest plural keys.
_TYPE_ALIASES: Dict[str, str] = {
    "repetition": "repetitions",
}

# Import AudioAssetService for voice variations
try:
    from services.audio_asset_service import AudioAssetService
    VOICE_VARIATIONS_AVAILABLE = True
except ImportError:
    logger.warning("⚠️ AudioAssetService not available, voice variations disabled")
    VOICE_VARIATIONS_AVAILABLE = False

# Import Gemini for sentence generation
try:
    from services.gemini_service import GeminiSentenceGenerator
    GEMINI_AVAILABLE = True
except ImportError:
    logger.warning("⚠️ GeminiSentenceGenerator not available")
    GEMINI_AVAILABLE = False

# Import TTS for audio generation
try:
    from services.tts_service import TTSService
    TTS_AVAILABLE = True
except ImportError:
    logger.warning("⚠️ TTSService not available")
    TTS_AVAILABLE = False




class RecommenderEngine:
    """
    Handles dynamic test item selection and assessment packaging.
    Loads sentence banks from audio_assets/sentence_banks/manifest.json
    (falls back to data/*.json if the manifest is not yet present).
    Supports multi-language assessments (English and Urdu).
    """
    def __init__(self):
        self.sentence_banks = {}
        self._load_banks()

    def _load_banks(self):
        """
        Load sentence banks from Firestore (sentence_banks collection).
        Falls back to local manifest / data/*.json if Firestore is unavailable.
        Normalises each sentence to expose a 'targets' key for internal use.
        """
        try:
            db = _get_sync_db()
            docs = list(db.collection("sentence_banks").stream())

            if not docs:
                raise ValueError("sentence_banks collection is empty in Firestore")

            for doc in docs:
                data = doc.to_dict()
                test_type = data.get("test_type", "")
                language = data.get("language", "english")
                sentences = data.get("sentences", [])

                # Normalise: map 'words' → 'targets' for downstream compatibility
                normalised = []
                for sent in sentences:
                    s = dict(sent)
                    if "words" in s and "targets" not in s:
                        s["targets"] = s["words"]
                    normalised.append(s)

                bank_key = f"{test_type}_{language}"
                self.sentence_banks[bank_key] = normalised
                logger.info(f"✅ Loaded {len(normalised)} sentences from Firestore: {bank_key}")

                # Register aliases (e.g., repetition → repetitions)
                for alias, canonical in _TYPE_ALIASES.items():
                    if test_type == canonical:
                        alias_key = f"{alias}_{language}"
                        self.sentence_banks[alias_key] = normalised
                        logger.info(f"✅ Aliased {bank_key} → {alias_key}")

            logger.info(f"📚 sentence_banks loaded from Firestore: {len(self.sentence_banks)} bank keys")

        except Exception as e:
            logger.warning(f"⚠️ Firestore load failed ({e}). Falling back to local files.")
            self._load_banks_legacy()

    def _load_banks_legacy(self):
        """
        Legacy loader: reads sentence banks from data/*.json files.
        Used as fallback when sentence_banks/manifest.json is not available.
        """
        loaded_prefixes = set()
        for test_type, file_prefix in _TYPE_TO_FILE.items():
            if file_prefix in loaded_prefixes:
                continue
            loaded_prefixes.add(file_prefix)

            for lang, path_prefix in [("english", ""), ("urdu", "urdu_")]:
                filepath = f"data/{path_prefix}{file_prefix}.json"
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        key = f"{test_type}_{lang}"
                        self.sentence_banks[key] = data.get("sentences", [])
                        logger.info(f"✅ Loaded {len(self.sentence_banks[key])} {lang} sentences (legacy): {key}")
                except FileNotFoundError:
                    logger.warning(f"⚠️ File not found: {filepath}")
                except json.JSONDecodeError as e:
                    logger.error(f"❌ JSON decode error in {filepath}: {e}")

    def _find_words_with_phoneme(self, bank: List[Dict], phoneme: str) -> List[Dict]:
        """
        Find all words containing a specific phoneme in expected_ipa array.
        Returns list of sentence IDs and difficulty levels.
        """
        matches = []

        for sentence in bank:
            found = False
            for target in sentence.get("targets", []):
                if phoneme in target.get("expected_ipa", []):
                    matches.append({
                        "sentence_id": sentence["id"],
                        "text": sentence["text"],
                        "word": target["word"],
                        "difficulty": sentence.get("difficulty", 2),
                    })
                    found = True
                    break  # Only count each sentence once

        return matches

    def _weight_by_difficulty(self, items: List[Dict], preferred_difficulty: int = 2) -> List[Dict]:
        """
        Sort items by proximity to preferred difficulty level.
        Difficulty scale: 1 (easy) to 3 (hard), prefer level 2.
        """
        def score(item):
            return abs(item.get("difficulty", 2) - preferred_difficulty)

        return sorted(items, key=score)

    async def generate_test_queue(
        self,
        test_type: str,
        focus_words: List[str],
        focus_phonemes: List[str],
        language: str = "english",
        preferred_difficulty: int = 2,
        danger_words: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Generate 6-10 sentences using exploitation/exploration strategy.
        When danger_words or focus_phonemes have no matching bank sentence,
        generates a new one via Gemini, adds audio to HF, and commits to Firestore.

        Exploitation:
        1. Prioritize sentences with focus words (exact match)
        2. Prioritize sentences with focus phonemes (IPA array match)

        Exploration:
        3. Fill remainder with random sentences, weighted by difficulty

        Gap-filling (Gemini):
        4. For each unmatched danger_word  → generate + commit new sentence
        5. For each unmatched focus_phoneme → generate + commit new sentence

        Args:
            test_type: Assessment type (e.g., "velar_fronting", "assess_velar_v1")
            focus_words: Words to prioritize (e.g., [\"cat\", \"king\"])
            focus_phonemes: Phonemes to prioritize (e.g., [\"k\", \"g\"])
            language: \"english\" or \"urdu\" (default: english)
            preferred_difficulty: Target difficulty (1-3, prefer 2)
            danger_words: Clinically challenging words (generate if unmatched)

        Returns:
            List of sentence dicts from the bank (6-10 items)
        """
        logger.info(f"Generating queue: {test_type} | Language: {language} | "
                   f"Focus: {focus_phonemes} | Words: {focus_words}")

        # Extract base test type if it has suffixes (e.g., "assess_velar_fronting_v1" -> "velar_fronting")
        # Remove prefixes and version suffix
        cleaned_type = test_type.replace("assess_", "").replace("test_", "")
        # Remove version suffix (e.g., "_v1", "_v2")
        base_type = cleaned_type.split("_v")[0] if "_v" in cleaned_type else cleaned_type
        bank_key = f"{base_type}_{language}"

        # Get bank with fallback to English
        bank = self.sentence_banks.get(
            bank_key,
            self.sentence_banks.get(f"{base_type}_english", [])
        )

        if not bank:
            logger.warning(f"🤷 No sentence bank found for: {bank_key}")
            return []

        queue = []
        used_ids = set()

        # 1. EXPLOITATION: Focus Words First (exact match)
        for word in focus_words:
            for sentence in bank:
                if sentence["id"] not in used_ids:
                    for target in sentence.get("targets", []):
                        if word.lower() in target.get("word", "").lower():
                            queue.append(sentence)
                            used_ids.add(sentence["id"])
                            break

        # 2. EXPLOITATION: Focus Phonemes Second (IPA array match)
        for phoneme in focus_phonemes:
            matches = self._find_words_with_phoneme(bank, phoneme)
            matches = self._weight_by_difficulty(matches, preferred_difficulty)

            for match in matches:
                if match["sentence_id"] not in used_ids:
                    sentence = next((s for s in bank if s["id"] == match["sentence_id"]), None)
                    if sentence:
                        queue.append(sentence)
                        used_ids.add(sentence["id"])

        # 3. EXPLORATION: Fill to minimum 6 items with difficulty weighting
        remaining = [s for s in bank if s["id"] not in used_ids]
        remaining = self._weight_by_difficulty(remaining, preferred_difficulty)

        # Shuffle the first 3 exploration candidates in-place to add variety.
        # Note: `remaining[:3]` creates a copy, so we must assign back.
        if len(remaining) > 3:
            top3 = remaining[:3]
            random.shuffle(top3)
            remaining[:3] = top3

        while len(queue) < 6 and remaining:
            queue.append(remaining.pop(0))

        # Cap at 10 items max
        queue = queue[:10]

        # ── 4 & 5. GAP-FILLING via Gemini ───────────────────────────────────
        # Determine which words/phonemes are already represented in the queue.
        _danger_words = danger_words or []

        words_in_queue: set = set()
        phonemes_in_queue: set = set()
        for sent in queue:
            for t in sent.get("targets", []):
                words_in_queue.add(t.get("word", "").lower())
                for p in t.get("expected_ipa", []):
                    phonemes_in_queue.add(p)

        # 4. Unmatched danger words → generate
        for dw in _danger_words:
            if len(queue) >= 10:
                break
            if dw.lower() not in words_in_queue:
                logger.info(f"⚙️ Generating sentence for unmatched danger word: '{dw}'")
                gen = await self._generate_and_commit(
                    test_type=base_type,
                    focus_phonemes=focus_phonemes,
                    danger_words=[dw],
                    language=language,
                )
                if gen:
                    queue.append(gen)
                    words_in_queue.add(dw.lower())
                    for t in gen.get("targets", []):
                        for p in t.get("expected_ipa", []):
                            phonemes_in_queue.add(p)

        # 5. Unmatched focus phonemes → generate
        for ph in focus_phonemes:
            if len(queue) >= 10:
                break
            if ph not in phonemes_in_queue:
                logger.info(f"⚙️ Generating sentence for unmatched phoneme: '{ph}'")
                gen = await self._generate_and_commit(
                    test_type=base_type,
                    focus_phonemes=[ph],
                    danger_words=_danger_words,
                    language=language,
                )
                if gen:
                    queue.append(gen)
                    for t in gen.get("targets", []):
                        for p in t.get("expected_ipa", []):
                            phonemes_in_queue.add(p)

        logger.info(f"Generated queue: {len(queue)} items for {base_type} ({language})")
        return queue

    def _build_assistant_lines(self, test_type: str, language: str) -> Dict[str, Any]:
        """
        Build assistant_lines object with randomly selected voice variations.
        Each item includes audio_url as a relative ZIP path: "audio/assistant/{file}".

        Returns:
            Dict with keys: intro, waiting, validation, transition, completion
            validation is a nested dict: {no_errors, single_error, multiple_errors}
        """
        if not VOICE_VARIATIONS_AVAILABLE:
            logger.warning("⚠️ Voice variations not available")
            return {}

        try:
            selected = AudioAssetService.select_random_assets(language, test_type)
            if not selected:
                logger.warning(f"⚠️ No voice variations selected for {test_type}")
                return {}

            assistant_lines: Dict[str, Any] = {}

            for category, items in selected.items():
                if category == "validation":
                    # items is {no_errors: [...], single_error: [...], multiple_errors: [...]}
                    assistant_lines["validation"] = {}
                    for val_key, val_items in items.items():
                        assistant_lines["validation"][val_key] = [
                            {
                                "id": item.get("id", ""),
                                "text": item.get("text", ""),
                                "audio_url": f"audio/assistant/{item.get('file', '')}",
                            }
                            for item in val_items
                        ]
                else:
                    # items is a list (intro, waiting, transition, completion)
                    entries = []
                    for item in items:
                        entry = {
                            "id": item.get("id", ""),
                            "text": item.get("text", ""),
                            "audio_url": f"audio/assistant/{item.get('file', '')}",
                        }
                        if "context" in item:
                            entry["context"] = item["context"]
                        entries.append(entry)
                    assistant_lines[category] = entries

            total = (
                len(assistant_lines.get("intro", [])) +
                len(assistant_lines.get("waiting", [])) +
                sum(len(v) for v in assistant_lines.get("validation", {}).values()) +
                len(assistant_lines.get("transition", [])) +
                len(assistant_lines.get("completion", []))
            )
            logger.info(f"✅ Built assistant_lines: {total} items")
            return assistant_lines

        except Exception as e:
            logger.error(f"❌ Error building assistant_lines: {e}")
            return {}

    async def build_assessment_plan(
        self,
        test_type: str,
        language: str = "english",
        module_id: str = "",
        title: str = "",
        focus_phonemes: Optional[List[str]] = None,
        danger_words: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Build the assessment plan dict (data.json content).
        Returns a plain dict — no ZIP, no file I/O.

        Args:
            test_type: Assessment type (e.g., "velar_fronting")
            language: Language code (default: "english")
            module_id: Assessment ID (e.g., "assess_velar_fronting_v1")
            title: Human-readable title
            focus_phonemes: IPA phonemes from questionnaire selection (e.g., ["k", "g"])
            danger_words: Clinically challenging words from questionnaire (e.g., ["cat", "king"])

        Returns:
            data.json content dict, or {} on failure
        """
        logger.info(f"📋 Building assessment plan: {test_type} ({language})")

        sentences = await self.generate_test_queue(
            test_type=test_type,
            focus_words=danger_words or [],
            focus_phonemes=focus_phonemes or [],
            language=language,
            preferred_difficulty=2,
            danger_words=danger_words or [],
        )

        if not sentences:
            logger.warning(f"⚠️ No sentences for {test_type} ({language})")
            return {}

        assistant_lines = self._build_assistant_lines(test_type, language)

        sentence_list = []
        for sentence in sentences:
            sentence_id = sentence.get("id", "")
            targets = sentence.get("targets", [])

            # Unique phonemes across all targets
            target_phonemes = list({
                p
                for t in targets
                for p in t.get("expected_ipa", [])
            })

            # Build per-word audio entries from the pre-computed file paths in targets
            words_audio = []
            for t in targets:
                word_file = t.get("file", "")
                if word_file:
                    # word_file: "english/blocks/word/en_blo_01_w0_Go.wav" — use basename for ZIP
                    words_audio.append({
                        "word": t.get("word", ""),
                        "audio_path": f"audio/word/{os.path.basename(word_file)}",
                    })

            sentence_list.append({
                "sentence_id": sentence_id,
                "text": sentence.get("text", ""),
                "romanized": sentence.get("romanized", ""),
                "difficulty": sentence.get("difficulty", 2),
                "target_phonemes": target_phonemes,
                "targets": targets,   # kept for analysis engine
                "audio": {
                    "full_sentence": f"audio/sentence/{sentence_id}.wav",
                    "words": words_audio,
                },
            })

        plan = {
            "module_id": module_id or f"assess_{test_type}_v1",
            "test_type": test_type,
            "title": title or test_type.replace("_", " ").title(),
            "language": language,
            "version": "1.0.0",
            "sentences": sentence_list,
            "assistant_lines": assistant_lines,
        }

        logger.info(f"✅ Plan built: {len(sentence_list)} sentences, module_id={plan['module_id']}")
        return plan

    async def build_assessment_bundle(self, plan: Dict[str, Any], language: str) -> bytes:
        """
        Assemble ZIP bytes from a plan dict, downloading audio from HuggingFace.
        Falls back to local disk for any file that fails to download.

        ZIP structure:
            data.json
            audio/sentence/{id}.wav
            audio/word/{id}_w{idx}_{word}.wav
            audio/assistant/{file}.mp3

        Args:
            plan: The data.json content dict from build_assessment_plan()
            language: "english" or "urdu"

        Returns:
            ZIP bytes
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        module_id = plan.get("module_id", "?")
        test_type = plan.get("test_type", "")
        lang_lower = language.lower()                     # sentence_banks uses lowercase
        lang_static = _hf_static_lang(language)           # static_tts uses 'english'/'Urdu'
        logger.info(f"📦 Building bundle for {module_id} (from HuggingFace)")

        # ── 1. Collect all (hf_url, zip_path) pairs to download ─────────────
        # Also build lookups so missing audio can be repaired via TTS.
        sentence_text_map: Dict[str, str] = {}          # sentence_id  → full text
        word_text_map: Dict[str, str] = {}               # word filename → word text
        for sent in plan.get("sentences", []):
            sid = sent.get("sentence_id", "")
            sentence_text_map[sid] = sent.get("text", "")
            for w_entry in sent.get("audio", {}).get("words", []):
                fname = os.path.basename(w_entry.get("audio_path", ""))
                word_text_map[fname] = w_entry.get("word", "")

        download_tasks: List[tuple] = []

        for sent in plan.get("sentences", []):
            sentence_id = sent.get("sentence_id", "")
            hf_url = f"{HF_AUDIO_BASE}/sentence_banks/{lang_lower}/{test_type}/sentence/{sentence_id}.wav"
            download_tasks.append((hf_url, f"audio/sentence/{sentence_id}.wav"))

            for word_entry in sent.get("audio", {}).get("words", []):
                zip_path = word_entry.get("audio_path", "")   # "audio/word/filename.wav"
                if zip_path:
                    word_filename = os.path.basename(zip_path)
                    hf_url = f"{HF_AUDIO_BASE}/sentence_banks/{lang_lower}/{test_type}/word/{word_filename}"
                    download_tasks.append((hf_url, zip_path))

        assistant = plan.get("assistant_lines", {})
        for cat in ["intro", "waiting", "transition", "completion"]:
            for item in assistant.get(cat, []):
                audio_url = item.get("audio_url", "")         # "audio/assistant/filename.mp3"
                if audio_url:
                    filename = os.path.basename(audio_url)
                    hf_url = f"{HF_AUDIO_BASE}/static_tts/{lang_static}/{filename}"
                    download_tasks.append((hf_url, audio_url))

        for val_items in assistant.get("validation", {}).values():
            for item in val_items:
                audio_url = item.get("audio_url", "")
                if audio_url:
                    filename = os.path.basename(audio_url)
                    hf_url = f"{HF_AUDIO_BASE}/static_tts/{lang_static}/{filename}"
                    download_tasks.append((hf_url, audio_url))

        # ── 2. Download all files in parallel ────────────────────────────────
        fetched: Dict[str, bytes] = {}
        missing_sentence_bank: List[tuple] = []  # (url, zip_path) — repairable via TTS

        with ThreadPoolExecutor(max_workers=20) as pool:
            future_to_zip = {pool.submit(_fetch_hf_bytes, url): (url, zpath)
                             for url, zpath in download_tasks}
            for future in as_completed(future_to_zip):
                url, zip_path = future_to_zip[future]
                data = future.result()
                if data:
                    fetched[zip_path] = data
                elif "/sentence_banks/" in url:
                    # Sentence-bank audio is repairable: generate + commit via TTS
                    missing_sentence_bank.append((url, zip_path))
                    logger.warning(f"⚠️ Missing sentence-bank audio (will repair): {url}")
                else:
                    logger.warning(f"⚠️ Failed to download static asset (skipped): {url}")

        # ── 2b. Repair missing sentence-bank audio via TTS ───────────────────
        if missing_sentence_bank:
            tts_lang = "ur" if lang_lower == "urdu" else "en"
            logger.info(f"🔧 Repairing {len(missing_sentence_bank)} missing audio file(s)...")

            for url, zip_path in missing_sentence_bank:
                is_word = "/word/" in url
                filename = os.path.basename(url.split("?")[0])
                hf_path = url.replace(f"{HF_AUDIO_BASE}/", "")

                try:
                    if is_word:
                        word_text = word_text_map.get(filename, "")
                        if not word_text:
                            logger.warning(f"⚠️ No word text found for repair: {filename}")
                            continue
                        # Word audio: slower rate for isolated word clarity
                        rate = "-30%" if tts_lang == "ur" else "+0%"
                        audio_bytes = await TTSService.synthesize_to_bytes(
                            text=word_text, lang=tts_lang, gender="f", rate=rate
                        )
                    else:
                        sentence_id = os.path.splitext(filename)[0]
                        sentence_text = sentence_text_map.get(sentence_id, "")
                        if not sentence_text:
                            logger.warning(f"⚠️ No sentence text found for repair: {sentence_id}")
                            continue
                        audio_bytes = await TTSService.synthesize_to_bytes(
                            text=sentence_text, lang=tts_lang, gender="f"
                        )

                    if audio_bytes:
                        self._upload_bytes_to_hf(audio_bytes, hf_path)
                        fetched[zip_path] = audio_bytes
                        logger.info(f"✅ Repaired and committed: {hf_path}")
                    else:
                        logger.error(f"❌ TTS repair failed for: {filename}")

                except Exception as e:
                    logger.error(f"❌ Repair error for {filename}: {e}")

        # ── 3. Assemble ZIP ───────────────────────────────────────────────────
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("data.json", json.dumps(plan, indent=2, ensure_ascii=False))
            for zip_path, data in fetched.items():
                zf.writestr(zip_path, data)

        bundle_size = zip_buffer.getbuffer().nbytes
        total_tasks = len(download_tasks)
        still_missing = total_tasks - len(fetched)
        logger.info(
            f"✅ Bundle assembled: {bundle_size:,} bytes "
            f"({len(fetched)}/{total_tasks} files, {still_missing} unresolved)"
        )
        return zip_buffer.getvalue()

    # ── HuggingFace upload helpers ──────────────────────────────────────────

    @staticmethod
    def _upload_bytes_to_hf(file_bytes: bytes, hf_path: str) -> bool:
        """
        Upload raw bytes to HuggingFace dataset junaiddbz/TTS_Audios.

        Args:
            file_bytes: Raw audio bytes (WAV or MP3)
            hf_path: Destination path inside the repo (e.g., "sentence_banks/english/blocks/sentence/gen_001.wav")

        Returns:
            True on success
        """
        try:
            from huggingface_hub import HfApi
            import tempfile
            token = os.getenv("HF_TOKEN", "")
            if not token:
                logger.warning("⚠️ HF_TOKEN not set — skipping HF audio upload")
                return False

            api = HfApi(token=token)
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(hf_path)[1]) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name
            try:
                api.upload_file(
                    path_or_fileobj=tmp_path,
                    path_in_repo=hf_path,
                    repo_id="junaiddbz/TTS_Audios",
                    repo_type="dataset",
                )
                logger.info(f"✅ Uploaded to HF: {hf_path}")
                return True
            finally:
                os.unlink(tmp_path)
        except Exception as e:
            logger.error(f"❌ HF upload failed for {hf_path}: {e}")
            return False

    @staticmethod
    def _hf_audio_exists(url: str) -> bool:
        """Return True if the HF audio file exists (HTTP HEAD check)."""
        try:
            import httpx
            r = httpx.head(url, timeout=10, follow_redirects=True)
            return r.status_code == 200
        except Exception:
            return False

    async def _generate_and_commit(
        self,
        test_type: str,
        focus_phonemes: List[str],
        danger_words: List[str],
        language: str = "english",
    ) -> Optional[Dict[str, Any]]:
        """
        Full pipeline for a single missing sentence:

        1. Generate sentence text + IPA targets via Gemini 2.5 Flash
        2. TTS sentence-level audio → upload WAV to HF
        3. TTS word-level audio for each target → upload WAVs to HF
        4. Append sentence to Firestore sentence bank ({test_type}_{language})
        5. Reload in-memory bank

        Returns:
            Sentence dict (with target["file"] populated) on success, None otherwise.
        """
        if not GEMINI_AVAILABLE:
            logger.warning("⚠️ Gemini not available — skipping gap-fill generation")
            return None
        if not TTS_AVAILABLE:
            logger.warning("⚠️ TTS not available — skipping gap-fill generation")
            return None

        from utils.logger import LANGUAGE_MAP

        lang_lower = language.lower()
        tts_lang = LANGUAGE_MAP.get(lang_lower, "en")

        # Map error_type from test_type (fluency types vs phonology)
        _FLUENCY_TYPES = {"blocks", "prolongation", "repetitions", "repetition"}
        if test_type in _FLUENCY_TYPES:
            error_type = "block" if test_type == "blocks" else (
                "prolongation" if test_type == "prolongation" else "stutter"
            )
        else:
            error_type = "substitution"  # Default for all phonology assessments

        try:
            # Step 1: Generate sentence with Gemini
            GeminiSentenceGenerator.initialize()
            gen_result = await GeminiSentenceGenerator.generate_sentence(
                error_type=error_type,
                focus_phonemes=focus_phonemes,
                danger_words=danger_words,
                language=lang_lower,
                difficulty=2,
            )
            if not gen_result:
                logger.error("❌ Gemini returned no sentence")
                return None

            sentence_id = gen_result["id"]
            sentence_text = gen_result["text"]
            logger.info(f"✅ Gemini generated: '{sentence_text}' (id={sentence_id})")

            # Step 2: TTS sentence audio → HF
            sentence_bytes = await TTSService.synthesize_to_bytes(
                text=sentence_text,
                lang=tts_lang,
                gender="f",
            )
            if not sentence_bytes:
                logger.error(f"❌ TTS failed for sentence: '{sentence_text}'")
                return None

            sentence_hf_path = f"sentence_banks/{lang_lower}/{test_type}/sentence/{sentence_id}.wav"
            self._upload_bytes_to_hf(sentence_bytes, sentence_hf_path)

            # Step 3: TTS word audio → HF (mutate targets in-place with file paths)
            # Word audio uses slower rate (-30%) matching bank_generator.ipynb WORD_RATE.
            # Coqui ignores the rate arg; edge-tts (used for Urdu) applies it.
            targets = gen_result.get("targets", [])
            for idx, target in enumerate(targets):
                word = target.get("word", "")
                if not word:
                    continue
                word_bytes = await TTSService.synthesize_to_bytes(
                    text=word,
                    lang=tts_lang,
                    gender="f",
                    rate="-30%",
                )
                if word_bytes:
                    safe_word = word.replace(" ", "_").replace("/", "_")[:40]
                    word_filename = f"{sentence_id}_w{idx}_{safe_word}.wav"
                    word_hf_path = f"sentence_banks/{lang_lower}/{test_type}/word/{word_filename}"
                    self._upload_bytes_to_hf(word_bytes, word_hf_path)
                    # Store relative path so build_assessment_bundle can fetch it
                    target["file"] = f"sentence_banks/{lang_lower}/{test_type}/word/{word_filename}"
                else:
                    logger.warning(f"⚠️ TTS failed for word: '{word}'")

            # Step 4 & 5: Append to Firestore + reload in-memory
            await self.add_generated_sentences_to_bank(test_type, [gen_result], lang_lower)

            logger.info(f"🎉 Gap-fill committed: {sentence_id}")
            return gen_result

        except Exception as e:
            logger.error(f"❌ _generate_and_commit failed: {e}")
            return None

    async def add_generated_sentences_to_bank(
        self,
        error_type: str,
        sentences: List[Dict[str, Any]],
        language: str = "english"
    ) -> bool:
        """
        Add generated sentences to the Firestore sentence bank and reload in memory.

        Args:
            error_type: Assessment type (e.g., "blocks", "velar_fronting")
            sentences: List of generated sentence dictionaries
            language: "english" or "urdu"

        Returns:
            True if sentences were added successfully
        """
        try:
            doc_id = f"{error_type}_{language}"
            db = _get_sync_db()
            doc_ref = db.collection("sentence_banks").document(doc_id)
            doc = doc_ref.get()

            if not doc.exists:
                logger.error(f"❌ Firestore document not found: sentence_banks/{doc_id}")
                return False

            existing = doc.to_dict().get("sentences", [])
            doc_ref.update({"sentences": existing + sentences})

            logger.info(f"✅ Added {len(sentences)} sentences to Firestore: {doc_id}")

            # Reload banks in memory
            self.sentence_banks = {}
            self._load_banks()
            return True

        except Exception as e:
            logger.error(f"❌ Failed to add sentences to Firestore: {e}")
            return False

# Singleton
recommender = RecommenderEngine()