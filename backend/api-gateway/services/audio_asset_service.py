"""
Audio Asset Service for Voice Variations Management

Manages the static TTS audio asset pool (voice variations) with:
- Manifest loading from audio_assets/static_tts/manifest.json
- Random selection algorithm per assessment
- Support for English and Urdu languages

Pool Structure (per language):
- intro files (assessment-type-specific fresh lines)
- resume files (assessment-type-specific resumption lines)
- waiting variations
- validation variations (perf / err / merr)
- transition variations
- completion variations

Selection Strategy (per assessment):
- intro: 2 items — 1 fresh (deterministic by test_type) + 1 resume (deterministic by test_type)
- waiting: 10 random
- validation: 5 no_errors + 5 single_error + 5 multiple_errors (random within each)
- transition: 10 random
- completion: 1 random
"""

import json
import random
import os
from typing import Dict, List, Optional, Any

from utils.logger import get_logger

logger = get_logger("AudioAssetService")

# Hugging Face dataset base URLs
HF_STATIC_TTS_BASE = "https://huggingface.co/datasets/junaiddbz/TTS_Audios/resolve/main/static_tts"
HF_MANIFEST_URL    = f"{HF_STATIC_TTS_BASE}/manifest.json"


def _hf_lang_dir(language: str) -> str:
    """Map language name to the exact case-sensitive folder stored on HF.
    sentence_banks uses lowercase; static_tts uses 'english' / 'Urdu'.
    """
    return "Urdu" if language.lower() == "urdu" else "english"


class AudioAssetService:
    """
    Manages local audio asset pool with manifest-based random selection.

    Assets stored in: audio_assets/static_tts/{language}/*.mp3
    Registry stored in: audio_assets/static_tts/manifest.json
    """

    _manifest = None  # Loaded at startup
    _manifest_path = "audio_assets/static_tts/manifest.json"

    @staticmethod
    def load_manifest() -> bool:
        """
        Load the static TTS manifest from the Hugging Face dataset.
        Falls back to local audio_assets/static_tts/manifest.json if HF is unreachable.

        Returns:
            True if manifest loaded successfully, False otherwise
        """
        import urllib.request

        # --- Try HF first ---
        try:
            logger.info(f"⬇️ Fetching manifest from HF: {HF_MANIFEST_URL}")
            with urllib.request.urlopen(HF_MANIFEST_URL, timeout=15) as resp:
                AudioAssetService._manifest = json.loads(resp.read())
            logger.info("✅ Manifest loaded from Hugging Face")
        except Exception as e:
            logger.warning(f"⚠️ HF manifest fetch failed ({e}). Trying local fallback...")
            # --- Local fallback ---
            try:
                if not os.path.exists(AudioAssetService._manifest_path):
                    logger.error(f"❌ Local manifest not found: {AudioAssetService._manifest_path}")
                    return False
                with open(AudioAssetService._manifest_path, 'r', encoding='utf-8') as f:
                    AudioAssetService._manifest = json.load(f)
                logger.info("✅ Manifest loaded from local file (fallback)")
            except Exception as e2:
                logger.error(f"❌ Local manifest load failed: {e2}")
                return False

        if not AudioAssetService._manifest:
            logger.error("❌ Manifest is empty")
            return False

        for lang in AudioAssetService._manifest.keys():
            if lang not in ["version", "generated_at"]:
                lang_data = AudioAssetService._manifest[lang]
                total_count = (
                    len(lang_data.get("intro", [])) +
                    len(lang_data.get("resume", [])) +
                    len(lang_data.get("waiting", [])) +
                    sum(len(v) for v in lang_data.get("validation", {}).values()) +
                    len(lang_data.get("transition", [])) +
                    len(lang_data.get("completion", []))
                )
                logger.info(f"✅ Loaded {total_count} audio assets for {lang}")

        return True

    @staticmethod
    def get_asset_pool(language: str) -> Dict[str, Any]:
        """
        Get full asset pool for a language.

        Args:
            language: "english" or "urdu"

        Returns:
            Dictionary with keys: intro, waiting, validation, transition, completion
            Returns empty dict if language not found or manifest not loaded
        """
        if AudioAssetService._manifest is None:
            logger.warning("⚠️ Manifest not loaded. Call load_manifest() first.")
            return {}

        if language not in AudioAssetService._manifest:
            logger.warning(f"⚠️ Language not found in manifest: {language}")
            return {}

        return AudioAssetService._manifest[language]

    @staticmethod
    def select_random_assets(language: str, test_type: str) -> Dict[str, Any]:
        """
        Select random subset of audio assets for a specific assessment.

        Selection logic:
        - intro: 2 items — [0] fresh (deterministic by test_type), [1] resume (deterministic)
        - waiting: 10 random
        - validation: dict with no_errors / single_error / multiple_errors (5 each, random)
        - transition: 10 random
        - completion: 1 random

        Args:
            language: "english" or "urdu"
            test_type: Assessment type (e.g., "velar_fronting", "blocks")

        Returns:
            Dict with keys: intro, waiting, validation, transition, completion
        """
        pool = AudioAssetService.get_asset_pool(language)

        if not pool:
            logger.error(f"❌ Cannot select assets: pool empty for {language}")
            return {}

        selected = {}

        # 1. INTRO (fresh): deterministic by test_type
        # Manifest IDs may be "intro_{test_type}" or "intro_NNN_{test_type}" — match by suffix.
        intro_items = pool.get("intro", [])
        intro_fresh = next((i for i in intro_items if i.get("id", "").endswith(f"_{test_type}")), None)
        if intro_fresh:
            logger.info(f"✅ Selected fresh intro for {test_type}: {intro_fresh.get('id')}")
        else:
            logger.warning(f"⚠️ Fresh intro not found for {test_type}, using fallback")
            intro_fresh = intro_items[0] if intro_items else {}

        # 2. RESUME: deterministic by test_type
        resume_items = pool.get("resume", [])
        resume_match = next((i for i in resume_items if i.get("id", "").endswith(f"_{test_type}")), None)
        if resume_match:
            logger.info(f"✅ Selected resume for {test_type}: {resume_match.get('id')}")
        else:
            logger.warning(f"⚠️ Resume not found for {test_type}, using fallback")
            resume_match = resume_items[0] if resume_items else {}

        # Merge context field and return as 2-item intro list
        fresh_item = {**intro_fresh, "context": "fresh"} if intro_fresh else {}
        resume_item = {**resume_match, "context": "resume"} if resume_match else {}
        selected["intro"] = [item for item in [fresh_item, resume_item] if item]

        # 3. WAITING: 10 random
        waiting_items = pool.get("waiting", [])
        selected["waiting"] = random.sample(waiting_items, min(10, len(waiting_items))) if waiting_items else []
        logger.info(f"✅ Selected {len(selected['waiting'])} waiting lines")

        # 4. VALIDATION: 5 each from perf/err/merr → returned as no_errors/single_error/multiple_errors
        validation_pool = pool.get("validation", {})

        perf_items = validation_pool.get("perf", [])
        err_items  = validation_pool.get("err", [])
        merr_items = validation_pool.get("merr", [])

        selected["validation"] = {
            "no_errors":       random.sample(perf_items, min(5, len(perf_items))) if perf_items else [],
            "single_error":    random.sample(err_items,  min(5, len(err_items)))  if err_items  else [],
            "multiple_errors": random.sample(merr_items, min(5, len(merr_items))) if merr_items else [],
        }
        total_val = sum(len(v) for v in selected["validation"].values())
        logger.info(f"✅ Selected {total_val} validation lines (no_errors/single_error/multiple_errors)")

        # 5. TRANSITION: 10 random
        transition_items = pool.get("transition", [])
        selected["transition"] = random.sample(transition_items, min(10, len(transition_items))) if transition_items else []
        logger.info(f"✅ Selected {len(selected['transition'])} transition lines")

        # 6. COMPLETION: 1 random
        completion_items = pool.get("completion", [])
        selected["completion"] = random.sample(completion_items, 1) if completion_items else []
        logger.info(f"✅ Selected {len(selected['completion'])} completion lines")

        total_selected = (
            len(selected["intro"]) +
            len(selected["waiting"]) +
            total_val +
            len(selected["transition"]) +
            len(selected["completion"])
        )
        logger.info(f"📦 Total assets selected: {total_selected} items for {test_type} ({language})")

        return selected

    @staticmethod
    def _find_asset_in_pool(pool: Dict[str, Any], asset_id: str) -> Optional[Dict]:
        """Return the first asset dict whose 'id' matches asset_id, or None."""
        for category in ["intro", "resume", "waiting", "transition", "completion"]:
            for item in pool.get(category, []):
                if item.get("id") == asset_id:
                    return item

        validation_pool = pool.get("validation", {})
        for context in ["perf", "err", "merr"]:
            for item in validation_pool.get(context, []):
                if item.get("id") == asset_id:
                    return item

        return None

    @staticmethod
    def get_asset_file_path(asset_id: str, language: str) -> Optional[str]:
        """
        Map asset ID to its Hugging Face URL.

        Args:
            asset_id: Asset identifier (e.g., "intro_comprehensive", "waiting_001")
            language: "english" or "urdu"

        Returns:
            HF URL if asset exists in manifest, None otherwise
        """
        pool = AudioAssetService.get_asset_pool(language)
        item = AudioAssetService._find_asset_in_pool(pool, asset_id)

        if item:
            file_name = item.get("file", "")
            if file_name:
                lang_dir = _hf_lang_dir(language)
                return f"{HF_STATIC_TTS_BASE}/{lang_dir}/{file_name}"

        logger.warning(f"⚠️ Asset not found: {asset_id} ({language})")
        return None

    @staticmethod
    def get_asset_text(asset_id: str, language: str) -> Optional[str]:
        """
        Get text content for an audio asset.

        Args:
            asset_id: Asset identifier
            language: "english" or "urdu"

        Returns:
            Text content if asset exists, None otherwise
        """
        pool = AudioAssetService.get_asset_pool(language)
        item = AudioAssetService._find_asset_in_pool(pool, asset_id)
        return item.get("text", "") if item else None

    @staticmethod
    def validate_manifest() -> bool:
        """
        Validate that the manifest has the required structure.
        File existence is not checked — assets live on Hugging Face.

        Returns:
            True if manifest structure is valid
        """
        if AudioAssetService._manifest is None:
            logger.error("❌ Manifest not loaded")
            return False

        required_categories = ["intro", "resume", "waiting", "validation", "transition", "completion"]
        required_langs = ["english", "urdu"]

        for language in required_langs:
            lang_data = AudioAssetService._manifest.get(language, {})
            if not lang_data:
                logger.warning(f"⚠️ Language missing from manifest: {language}")
                continue
            for cat in required_categories:
                if cat not in lang_data:
                    logger.warning(f"⚠️ Category missing in manifest[{language}]: {cat}")

        logger.info("✅ Manifest structure validated (assets are on Hugging Face)")
        return True
