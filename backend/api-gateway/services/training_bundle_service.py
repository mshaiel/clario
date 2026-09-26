"""
Training Bundle Service

Assembles on-demand ZIP bundles for training modules.

Bundle structure:
    data.json                     ← plan metadata + levels + assistant_lines
    audio/
        item/
            lv{L}_item{N}.wav     ← TTS-synthesised exercise item audio
        assistant/
            {filename}.wav        ← static audio downloaded from HF TrainingTTS

data.json schema (see implementation_plan.md for details).
"""

import asyncio
import io
import json
import os
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

import httpx

from services.training_asset_service import TrainingAssetService, HF_TRAINING_BASE
from services.tts_service import TTSService
from utils.logger import get_logger, LANGUAGE_MAP

logger = get_logger("TrainingBundleService")

_MAX_PARALLEL_DOWNLOADS = 20
_MAX_CONCURRENT_TTS = 5

HF_TOKEN = os.getenv("HF_TOKEN", "")


def _fetch_bytes(url: str) -> Optional[bytes]:
    """Blocking HTTP GET — runs in a thread pool. Returns None on failure."""
    headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}
    try:
        r = httpx.get(url, timeout=20, follow_redirects=True, headers=headers)
        if r.status_code == 200:
            return r.content
        logger.warning(f"⚠️ HF fetch HTTP {r.status_code}: {url}")
        return None
    except Exception as e:
        logger.warning(f"⚠️ HF fetch failed ({e}): {url}")
        return None


async def build_training_bundle(plan: Dict[str, Any], language: str) -> bytes:
    """
    Assemble a ZIP for one training module.

    Steps:
      1. For every level in the plan:
         a. Select static assistant audio (TrainingAssetService)
         b. Collect download tasks for static HF files
         c. Collect TTS synthesis tasks for exercise items
      2. Download all static files in parallel (thread pool)
      3. Synthesise all item audio in parallel (async)
      4. Pack data.json + all audio into a ZIP
      5. Return ZIP bytes

    Args:
        plan:     Training plan dict as stored in Firestore
                  (output of TrainingService.generate_strategy, after normalisation)
        language: "english" or "urdu"

    Returns:
        Raw ZIP bytes
    """
    lang_lower = language.lower()
    tts_lang = LANGUAGE_MAP.get(lang_lower, "en")
    module_id = plan.get("module_id", "unknown")
    logger.info(f"📦 Building training bundle for {module_id} ({lang_lower})")

    # ── 1. Enrich levels with assistant_lines + collect tasks ─────────────────
    levels_enriched: List[Dict[str, Any]] = []
    # (zip_path, hf_url) pairs for static files
    static_tasks: List[Tuple[str, str]] = []
    # (zip_path, item_text) pairs for TTS synthesis
    tts_tasks: List[Tuple[str, str]] = []

    for level in plan.get("levels", []):
        lvl_idx = level.get("level_index", 0)
        fmt = level.get("format", "")

        # a. Select static assistant audio
        assets = TrainingAssetService.select_assets(language=language, format_type=fmt)

        # b. Build assistant_lines for data.json (already has audio_url relative paths)
        assistant_lines = assets  # already shaped correctly

        # c. Collect static download tasks
        for category, items in _flatten_asset_items(assets):
            for item in items:
                filename = item.get("file", "")
                if filename:
                    zip_path = f"audio/assistant/{filename}"
                    hf_url = TrainingAssetService.hf_url(filename)
                    static_tasks.append((zip_path, hf_url))

        # d. Build item list with audio_paths + collect TTS tasks
        items_out: List[Dict[str, Any]] = []
        raw_items_container = level.get("items", [])
        
        # CTM nests the actual item array inside a dict.
        if isinstance(raw_items_container, dict):
            if "pairs" in raw_items_container:
                raw_items = raw_items_container.get("pairs", [])
            else:
                raw_items = raw_items_container.get("items", [])
        else:
            raw_items = raw_items_container

        for item_idx, item in enumerate(raw_items):
            if isinstance(item, dict):
                # Try to find best text for TTS
                item_text = item.get("text") or item.get("full_sentence") or item.get("word") or item.get("display_text")
                if not item_text and "target" in item and isinstance(item["target"], dict):
                    item_text = item["target"].get("word", "")
                if not item_text:
                    item_text = str(item)

                item_id = f"lv{lvl_idx}_item{item_idx}"
                zip_path = f"audio/item/{item_id}.wav"
                tts_tasks.append((zip_path, str(item_text)))

                # Preserve all metadata from the CTM item
                item_out = dict(item)
                item_out["item_id"] = item_id
                item_out["audio_path"] = zip_path

                # Bug 13 fix: for Syllable_Chaining, also generate per-chunk audio so
                # the frontend can play individual chunk audio offline without live TTS.
                if fmt == "Syllable_Chaining":
                    visual_chunks = item.get("visual_chunks", [])
                    phonemic_chunks = item.get("phonemic_chunks", [])
                    chunk_audio_paths: list = []
                    for chunk_idx, chunk_text in enumerate(visual_chunks):
                        chunk_id = f"{item_id}_chunk{chunk_idx}"
                        chunk_zip = f"audio/item/{chunk_id}.wav"
                        # Always use the visual (orthographic) chunk text for TTS.
                        # phonemic_chunks contain raw IPA (e.g. "k r aː") which TTS
                        # engines cannot pronounce — they are used only for analysis.
                        tts_tasks.append((chunk_zip, chunk_text))
                        chunk_audio_paths.append(chunk_zip)
                    item_out["chunk_audio_paths"] = chunk_audio_paths

                items_out.append(item_out)
            else:
                item_text = str(item)
                item_id = f"lv{lvl_idx}_item{item_idx}"
                zip_path = f"audio/item/{item_id}.wav"
                tts_tasks.append((zip_path, item_text))
                items_out.append({
                    "item_id":    item_id,
                    "text":       item_text,
                    "audio_path": zip_path,
                })

        # e. Build enriched level dict
        level_out = {
            "level_index":      lvl_idx,
            "format":           fmt,
            "difficulty":       level.get("difficulty", 2),
            "structure":        level.get("structure", ""),
            "production_mode":  level.get("production_mode", "imitation"),
            "success_criteria": level.get("success_criteria", {}),
            "exercise_params":  plan.get("exercise_params", {}),
            "items":            items_out,
            "assistant_lines":  assistant_lines,
        }
        levels_enriched.append(level_out)

    # ── 2. Download static HF files (thread pool, parallel) ───────────────────
    # De-duplicate by zip_path
    unique_static: Dict[str, str] = {zp: hu for zp, hu in static_tasks}
    fetched: Dict[str, bytes] = {}

    if unique_static:
        with ThreadPoolExecutor(max_workers=_MAX_PARALLEL_DOWNLOADS) as pool:
            future_map = {
                pool.submit(_fetch_bytes, hf_url): zip_path
                for zip_path, hf_url in unique_static.items()
            }
            for future in as_completed(future_map):
                zip_path = future_map[future]
                data = future.result()
                if data:
                    fetched[zip_path] = data
                else:
                    logger.warning(f"⚠️ Static asset missing (skipped): {zip_path}")

        logger.info(
            f"📥 Static audio: {len(fetched)}/{len(unique_static)} files downloaded"
        )

    # ── 3. Synthesise item TTS audio (parallel with semaphore) ────────────────
    unique_tts: Dict[str, str] = {zp: tx for zp, tx in tts_tasks}
    sem = asyncio.Semaphore(_MAX_CONCURRENT_TTS)

    async def _safe_synthesize(zip_path: str, text: str) -> Tuple[str, Optional[bytes]]:
        if not text:
            return zip_path, None
        async with sem:
            try:
                audio = await TTSService.synthesize_to_bytes(
                    text=text, lang=tts_lang, gender="f"
                )
                return zip_path, audio
            except Exception as e:
                logger.error(f"❌ TTS synthesis failed for {zip_path!r}: {e}")
                return zip_path, None

    tts_coros = [
        _safe_synthesize(zp, tx) for zp, tx in unique_tts.items()
    ]
    tts_results = await asyncio.gather(*tts_coros)

    synthesised = 0
    for zip_path, audio_bytes in tts_results:
        if audio_bytes:
            fetched[zip_path] = audio_bytes
            synthesised += 1

    logger.info(f"🔊 Item TTS: {synthesised}/{len(unique_tts)} items synthesised")

    # ── 4. Build data.json ─────────────────────────────────────────────────────
    data_json = {
        "module_id":       module_id,
        "error_name":      plan.get("error_name", ""),
        "major_type":      plan.get("major_type", ""),
        "severity":        plan.get("severity", 0.0),
        "language":        lang_lower,
        "exercise_params": plan.get("exercise_params", {}),
        "active_phonemes": plan.get("active_phonemes", []),
        "levels":          levels_enriched,
    }

    # ── 5. Assemble ZIP ────────────────────────────────────────────────────────
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("data.json", json.dumps(data_json, indent=2, ensure_ascii=False))
        for zip_path, audio_bytes in fetched.items():
            zf.writestr(zip_path, audio_bytes)

    bundle_bytes = buf.getvalue()
    total_items = len(fetched) + 1  # +1 for data.json
    logger.info(
        f"✅ Bundle assembled: {len(bundle_bytes):,} bytes, "
        f"{total_items} files ({module_id})"
    )
    return bundle_bytes


# ── Helpers ────────────────────────────────────────────────────────────────────

def _flatten_asset_items(assets: Dict[str, Any]):
    """
    Yield (category_name, items_list) pairs from the structured assets dict.
    Handles nested dicts (validation, cues, gating).
    """
    for key, value in assets.items():
        if isinstance(value, list):
            yield key, value
        elif isinstance(value, dict):
            for sub_key, sub_items in value.items():
                if isinstance(sub_items, list):
                    yield f"{key}.{sub_key}", sub_items
