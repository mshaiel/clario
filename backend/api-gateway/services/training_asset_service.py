"""
Training Asset Service — static audio assets for training modules.

Loads manifest.training.json from junaiddbz/TrainingTTS on HuggingFace and
exposes a random-selection API for assembling assistant_lines inside training
module ZIP bundles.

Asset categories (from manifest.training.json):
  intro          — format-specific fresh/resume narration
  resume         — format-specific re-entry narration (merged into intro list)
  waiting        — analysis-waiting lines
  transition     — between-item transition lines
  completion     — module/session completion lines
  validation     — {no_errors, single_error, multiple_errors}
  cues           — {cue_soft, cue_firm, cue_model, cue_pacing}
  gating         — {gate_hold, gate_repeat, gate_advance, gate_reset}
  format_prompts — format-specific instruction lines (keyed by format slug)

File naming on HF:
  {lang_prefix}_train_{category}_{seq}.wav
  e.g.  en_train_waiting_001.wav
        ur_train_fmt_minimal_pairs_002.wav

HF base URL: https://huggingface.co/datasets/junaiddbz/TrainingTTS/resolve/main/
"""

import json
import os
import random
import httpx
from typing import Any, Dict, List, Optional

from utils.logger import get_logger

logger = get_logger("TrainingAssetService")

# ── Constants ─────────────────────────────────────────────────────────────────
HF_TRAINING_BASE = (
    "https://huggingface.co/datasets/junaiddbz/TrainingTTS/resolve/main"
)
HF_MANIFEST_URL = f"{HF_TRAINING_BASE}/manifest.training.json"

# CTM format names → manifest format_prompts key (lowercased, underscored)
_FORMAT_SLUG: Dict[str, str] = {
    "Auditory_Bombardment": "auditory_bombardment",
    "Phoneme_Isolation":    "phoneme_isolation",
    "Minimal_Pairs":        "minimal_pairs",
    "Syllable_Chaining":    "syllable_chaining",
    "Carrier_Phrases":      "carrier_phrases",
    "Pacing":               "pacing",
    "Shadowing":            "shadowing",
    "Speed_Drills":         "speed_drills",
}


def _lang_prefix(language: str) -> str:
    """Map language name → HF file prefix ('en' or 'ur')."""
    return "ur" if language.lower() == "urdu" else "en"


class TrainingAssetService:
    """
    Manages the static training audio asset pool backed by
    junaiddbz/TrainingTTS on HuggingFace.

    Call load_manifest() once at startup; then use select_assets() per level.
    """

    _manifest: Optional[Dict[str, Any]] = None
    _local_fallback = "audio_assets/training_tts/manifest.training.json"

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    @classmethod
    def load_manifest(cls) -> bool:
        """
        Fetch manifest.training.json from HuggingFace.
        Falls back to a local copy if the network is unavailable.

        Returns True on success.
        """
        token = os.getenv("HF_TOKEN", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}

        # 1. Try HF
        try:
            logger.info(f"⬇️ Fetching training manifest from HF: {HF_MANIFEST_URL}")
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                resp = client.get(HF_MANIFEST_URL, headers=headers)
                resp.raise_for_status()
                cls._manifest = resp.json()
            logger.info("✅ Training manifest loaded from HuggingFace")
            cls._log_summary()
            return True
        except Exception as e:
            logger.warning(f"⚠️ HF training manifest fetch failed ({e}). Trying local fallback…")

        # 2. Local fallback
        try:
            if not os.path.exists(cls._local_fallback):
                logger.error(f"❌ Local training manifest not found: {cls._local_fallback}")
                return False
            with open(cls._local_fallback, "r", encoding="utf-8") as f:
                cls._manifest = json.load(f)
            logger.info("✅ Training manifest loaded from local fallback")
            cls._log_summary()
            return True
        except Exception as e2:
            logger.error(f"❌ Local training manifest load failed: {e2}")
            return False

    @classmethod
    def _log_summary(cls) -> None:
        if not cls._manifest:
            return
        for lang in ("english", "urdu"):
            pool = cls._manifest.get(lang, {})
            if not pool:
                continue
            n = (
                len(pool.get("intro", []))
                + len(pool.get("resume", []))
                + len(pool.get("waiting", []))
                + len(pool.get("transition", []))
                + len(pool.get("completion", []))
                + sum(len(v) for v in pool.get("validation", {}).values())
                + sum(len(v) for v in pool.get("cues", {}).values())
                + sum(len(v) for v in pool.get("gating", {}).values())
                + sum(len(v) for v in pool.get("format_prompts", {}).values())
            )
            logger.info(f"  📦 {lang}: {n} training audio assets loaded")

    # ── Public API ─────────────────────────────────────────────────────────────

    @classmethod
    def select_assets(cls, language: str, format_type: str) -> Dict[str, Any]:
        """
        Select a random subset of static audio assets for one training level.

        Args:
            language:    "english" or "urdu"
            format_type: CTM format name e.g. "Minimal_Pairs", "Pacing"

        Returns:
            Dict with keys:
              intro        → list (fresh + resume items with 'context' tag)
              waiting      → list (up to 5 random)
              transition   → list (up to 5 random)
              completion   → list (1 random)
              validation   → {no_errors, single_error, multiple_errors} (2 each)
              cues         → {cue_soft, cue_firm, cue_model, cue_pacing} (2 each)
              gating       → {gate_hold, gate_repeat, gate_advance, gate_reset} (2 each)
              format_prompts → list (all available for this format, max 4)

            Each item dict contains:
              id, text, file, audio_url  (relative ZIP path "audio/assistant/{file}")
        """
        if cls._manifest is None:
            logger.warning("⚠️ Training manifest not loaded — call load_manifest() first")
            return {}

        lang = language.lower()
        pool = cls._manifest.get(lang, {})
        if not pool:
            logger.warning(f"⚠️ No training assets for language: {lang}")
            return {}

        fmt_slug = _FORMAT_SLUG.get(format_type, format_type.lower().replace(" ", "_"))
        result: Dict[str, Any] = {}

        def _pick(items: List[Dict], n: int) -> List[Dict]:
            return random.sample(items, min(n, len(items))) if items else []

        def _enrich(items: List[Dict]) -> List[Dict]:
            """Add audio_url (relative ZIP path) to each item."""
            out = []
            for it in items:
                d = dict(it)
                d["audio_url"] = f"audio/assistant/{it['file']}"
                out.append(d)
            return out

        # ── intro (fresh + resume, one each, deterministic by format_type) ───
        intro_items = pool.get("intro", [])
        resume_items = pool.get("resume", [])

        fresh = next(
            (i for i in intro_items if format_type.lower() in i.get("id", "").lower()),
            intro_items[0] if intro_items else None,
        )
        resume = next(
            (i for i in resume_items if format_type.lower() in i.get("id", "").lower()),
            resume_items[0] if resume_items else None,
        )
        intro_list = []
        if fresh:
            intro_list.append({**dict(fresh), "context": "fresh", "audio_url": f"audio/assistant/{fresh['file']}"})
        if resume:
            intro_list.append({**dict(resume), "context": "resume", "audio_url": f"audio/assistant/{resume['file']}"})
        result["intro"] = intro_list

        # ── waiting ───────────────────────────────────────────────────────────
        result["waiting"] = _enrich(_pick(pool.get("waiting", []), 5))

        # ── transition ────────────────────────────────────────────────────────
        result["transition"] = _enrich(_pick(pool.get("transition", []), 5))

        # ── completion ────────────────────────────────────────────────────────
        result["completion"] = _enrich(_pick(pool.get("completion", []), 1))

        # ── validation ────────────────────────────────────────────────────────
        val_pool = pool.get("validation", {})
        result["validation"] = {
            "no_errors":       _enrich(_pick(val_pool.get("no_errors",       []), 2)),
            "single_error":    _enrich(_pick(val_pool.get("single_error",    []), 2)),
            "multiple_errors": _enrich(_pick(val_pool.get("multiple_errors", []), 2)),
        }

        # ── cues ──────────────────────────────────────────────────────────────
        cue_pool = pool.get("cues", {})
        result["cues"] = {
            "cue_soft":   _enrich(_pick(cue_pool.get("cue_soft",   []), 2)),
            "cue_firm":   _enrich(_pick(cue_pool.get("cue_firm",   []), 2)),
            "cue_model":  _enrich(_pick(cue_pool.get("cue_model",  []), 2)),
            "cue_pacing": _enrich(_pick(cue_pool.get("cue_pacing", []), 2)),
        }

        # ── gating ────────────────────────────────────────────────────────────
        gate_pool = pool.get("gating", {})
        result["gating"] = {
            "gate_hold":    _enrich(_pick(gate_pool.get("gate_hold",    []), 2)),
            "gate_repeat":  _enrich(_pick(gate_pool.get("gate_repeat",  []), 2)),
            "gate_advance": _enrich(_pick(gate_pool.get("gate_advance", []), 2)),
            "gate_reset":   _enrich(_pick(gate_pool.get("gate_reset",   []), 2)),
        }

        # ── format_prompts ────────────────────────────────────────────────────
        fmt_prompts = pool.get("format_prompts", {}).get(fmt_slug, [])
        result["format_prompts"] = _enrich(fmt_prompts)  # all, up to 4

        total = (
            len(result["intro"])
            + len(result["waiting"])
            + len(result["transition"])
            + len(result["completion"])
            + sum(len(v) for v in result["validation"].values())
            + sum(len(v) for v in result["cues"].values())
            + sum(len(v) for v in result["gating"].values())
            + len(result["format_prompts"])
        )
        logger.info(
            f"✅ Training assets selected: {total} items "
            f"(lang={lang}, format={format_type})"
        )
        return result

    @classmethod
    def hf_url(cls, filename: str) -> str:
        """Return the full HuggingFace download URL for a training audio file."""
        return f"{HF_TRAINING_BASE}/{filename}"
