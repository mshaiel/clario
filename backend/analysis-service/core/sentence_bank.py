import os
import logging
from typing import Dict, List, Optional
from dataclasses import dataclass, field

logger = logging.getLogger("SentenceBank")


@dataclass
class TargetWord:
    word: str
    expected_ipa: List[str]


@dataclass
class SentenceEntry:
    id: str
    text: str
    difficulty: int
    test_type: str
    targets: List[TargetWord] = field(default_factory=list)


class SentenceBankService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SentenceBankService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.sentences: Dict[str, SentenceEntry] = {}
        self.by_type: Dict[str, List[SentenceEntry]] = {}

        self._load_from_firestore()
        self._initialized = True

    # ─── FIREBASE INIT ────────────────────────────────────────────────────

    def _init_firebase(self) -> bool:
        """Initialize Firebase Admin SDK. Returns True on success."""
        try:
            import firebase_admin
            from firebase_admin import credentials

            if firebase_admin._apps:
                return True  # Already initialized

            cred = None

            # 1. Try GOOGLE_CREDENTIALS_JSON env var (full JSON string — used on HF Spaces)
            creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
            if creds_json:
                import json
                cred = credentials.Certificate(json.loads(creds_json))
                logger.info("🔑 Using Firebase credentials from GOOGLE_CREDENTIALS_JSON env var.")

            # 2. Try GOOGLE_APPLICATION_CREDENTIALS file path
            if not cred:
                cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
                if cred_path and os.path.exists(cred_path):
                    cred = credentials.Certificate(cred_path)
                    logger.info(f"🔑 Using Firebase credentials from {cred_path}.")

            # 3. Fall back to key.json in project root
            if not cred:
                if os.path.exists("key.json"):
                    cred = credentials.Certificate("key.json")
                    logger.info("🔑 Using Firebase credentials from key.json.")

            if not cred:
                logger.error(
                    "Firebase credentials not found. Set GOOGLE_CREDENTIALS_JSON secret "
                    "or GOOGLE_APPLICATION_CREDENTIALS, or place key.json in project root."
                )
                return False

            firebase_admin.initialize_app(cred)
            logger.info("✅ Firebase initialized.")
            return True

        except Exception as e:
            logger.error(f"❌ Firebase initialization failed: {e}")
            return False

    # ─── FIRESTORE LOADER ─────────────────────────────────────────────────

    def _load_from_firestore(self):
        """
        Load all sentence banks from Firestore `sentence_banks` collection.
        Each document is keyed `{test_type}_{language}` and contains a
        `sentences` array whose items have: id, text, difficulty, words[].
        The `words` array maps to `targets` (word, expected_ipa fields).
        """
        if not self._init_firebase():
            return

        try:
            from firebase_admin import firestore
            db = firestore.client()

            docs = list(db.collection("sentence_banks").stream())
            total_loaded = 0

            for doc in docs:
                data = doc.to_dict()
                test_type = data.get("test_type", "unknown")

                for item in data.get("sentences", []):
                    targets = []
                    # Firestore stores phonetic targets under "words" key;
                    # fall back to "targets" for forward compatibility.
                    for w in item.get("words", item.get("targets", [])):
                        ipa = w.get("expected_ipa", [])
                        if isinstance(ipa, str):
                            ipa = list(ipa)
                        targets.append(TargetWord(
                            word=w["word"],
                            expected_ipa=ipa,
                        ))

                    entry = SentenceEntry(
                        id=item["id"],
                        text=item["text"],
                        difficulty=item.get("difficulty", 1),
                        test_type=test_type,
                        targets=targets,
                    )

                    self.sentences[entry.id] = entry

                    if test_type not in self.by_type:
                        self.by_type[test_type] = []
                    self.by_type[test_type].append(entry)
                    total_loaded += 1

            logger.info(
                f"📚 Loaded {total_loaded} sentences from Firestore "
                f"across {len(self.by_type)} test types."
            )

        except Exception as e:
            logger.error(f"❌ Failed to load sentence banks from Firestore: {e}")

    # ─── PUBLIC API ───────────────────────────────────────────────────────

    def reload(self):
        """Clear in-memory bank and reload from Firestore."""
        logger.info("🔄 Reloading sentence bank from Firestore...")
        self.sentences = {}
        self.by_type = {}
        self._load_from_firestore()
        logger.info(f"✅ Sentence bank reloaded: {len(self.sentences)} sentences")

    def get_sentence(self, sentence_id: str) -> Optional[SentenceEntry]:
        entry = self.sentences.get(sentence_id)
        if entry is None:
            # Sentence not in memory — Firestore may have been updated since startup.
            # Reload once and retry before giving up.
            logger.info(f"⚠️ '{sentence_id}' not in memory — reloading from Firestore")
            self.reload()
            entry = self.sentences.get(sentence_id)
            if entry is None:
                logger.error(f"❌ '{sentence_id}' not found even after reload")
        return entry

    def get_sentences_for_test(self, test_type: str) -> List[SentenceEntry]:
        return self.by_type.get(test_type, [])


def get_sentence_bank() -> SentenceBankService:
    return SentenceBankService()
