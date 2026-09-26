"""
Analysis Service for UAB
Handles audio analysis by delegating to the Clario Analysis Backend.
Parses responses into polymorphic error objects and manages mode-dependent fields.
"""
import asyncio
import base64
import os
from typing import Dict, Any, List, Optional

import httpx
from fastapi import HTTPException

from api.schemas import (
    AnalyzeAudioResponse,
    PhonologyError, ProlongationError, StutterError, BlockError,
    FlaggedWordUnion
)
from core.conversation_engine import conversation_engine
from services.tts_service import TTSService
from utils.logger import get_logger, LANGUAGE_MAP

logger = get_logger("AnalysisService")

# Configuration from environment or defaults
ANALYSIS_BACKEND_URL = os.getenv("ANALYSIS_BACKEND_URL", "https://junaiddbz-clario-analysis-module.hf.space")
ANALYSIS_TIMEOUT = 30.0  # seconds
ANALYSIS_RETRIES = 3


class AnalysisService:
    """
    Audio analysis service - stateless speech error detection.
    Handles mode parameter to control response verbosity:
    - "efficient": Fast path, minimal response data
    - "assistant": Full response with dynamic AI coaching
    """

    @staticmethod
    async def analyze_audio(
        audio_bytes: bytes,
        sentence_id: str,
        test_type: str,
        mode: str = "assistant",
        language: str = "english",
        targets_json: Optional[str] = None,
        filename: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> AnalyzeAudioResponse:
        """
        Analyze single sentence audio in isolation (stateless).

        Args:
            audio_bytes: Binary audio data
            sentence_id: Sentence identifier (e.g., "s_104")
            test_type: Clinical test type (e.g., "velar_fronting", "comprehensive")
            mode: "efficient" = minimal response, "assistant" = with coaching
            language: Language code (e.g., "english", "urdu")

        Returns:
            AnalyzeAudioResponse with polymorphic error array
        """
        logger.info(
            f"📊 Audio Analysis: {sentence_id} [{test_type}] "
            f"mode={mode} language={language}"
        )

        # 1. Call Analysis Backend
        raw_analysis = await AnalysisService._call_backend(
            audio_bytes=audio_bytes,
            sentence_id=sentence_id,
            test_type=test_type,
            language=language,
            targets_json=targets_json,
            filename=filename,
            content_type=content_type
        )

        if not raw_analysis.get("success"):
            backend_error = raw_analysis.get("error", "Unknown analysis backend error")
            logger.error(f"Analysis backend failure for {sentence_id}: {backend_error}")
            raise HTTPException(
                status_code=500,
                detail=f"Audio analysis backend error: {backend_error}"
            )

        # 2. Parse into polymorphic errors
        flagged_words = await AnalysisService._parse_polymorphic_errors(
            raw_analysis=raw_analysis,
            sentence_id=sentence_id,
            test_type=test_type,
            mode=mode,
            language=language
        )

        # 3. Return structured response
        accuracy = raw_analysis.get("accuracy_score", 0)
        response = AnalyzeAudioResponse(
            sentence_id=sentence_id,
            sentence_accuracy=float(accuracy),
            transcript=raw_analysis.get("transcript", ""),
            word_results=raw_analysis.get("word_results", []),
            flagged_words=flagged_words,
            # Pass SODA per-test results through so the frontend can classify errors.
            # Without this field the CAM's clinical event data is silently discarded.
            results=raw_analysis.get("results"),
        )

        logger.info(
            f"✅ Analysis complete: {sentence_id} - "
            f"Accuracy: {accuracy}% - Errors: {len(flagged_words)}"
        )

        return response

    @staticmethod
    async def analyze_text(
        audio_bytes: bytes,
        text: str,
        test_type: str,
        mode: str = "efficient",
        language: str = "english",
        expected_phonemes: Optional[str] = None,
        targets_json: Optional[str] = None,
        filename: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> AnalyzeAudioResponse:
        """
        Full-pipeline analysis using free text instead of a sentence_id.
        Delegates to CAM's /analyze-text endpoint, then processes the response
        through the same AnalyzeAudioResponse pipeline as analyze_audio.
        """
        import json as _json

        logger.info(f"📊 Text Analysis: '{text}' [{test_type}] mode={mode}")

        raw_analysis = await AnalysisService._call_backend_text(
            audio_bytes=audio_bytes,
            text=text,
            test_type=test_type,
            language=language,
            expected_phonemes=expected_phonemes,
            targets_json=targets_json,
            filename=filename,
            content_type=content_type
        )

        if not raw_analysis.get("success"):
            backend_error = raw_analysis.get("error", "Unknown analysis backend error")
            logger.error(f"analyze-text backend failure for '{text}': {backend_error}")
            raise HTTPException(status_code=503, detail=f"Analysis backend error: {backend_error}")

        # Parse + build response — same pipeline as analyze_audio
        flagged_words = await AnalysisService._parse_polymorphic_errors(
            raw_analysis=raw_analysis,
            sentence_id=text,
            test_type=test_type,
            mode=mode,
            language=language
        )

        accuracy = raw_analysis.get("accuracy_score", 0)
        response = AnalyzeAudioResponse(
            sentence_id=text,
            sentence_accuracy=float(accuracy),
            transcript=raw_analysis.get("transcript", ""),
            word_results=raw_analysis.get("word_results", []),
            flagged_words=flagged_words,
            # Pass SODA per-test results through — same reasoning as analyze_audio.
            results=raw_analysis.get("results"),
        )

        logger.info(f"✅ analyze-text complete: '{text}' - Accuracy: {accuracy}% - Errors: {len(flagged_words)}")
        return response

    @staticmethod
    async def _call_backend_text(
        audio_bytes: bytes,
        text: str,
        test_type: str,
        language: str = "english",
        expected_phonemes: Optional[str] = None,
        targets_json: Optional[str] = None,
        filename: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """Call CAM's /analyze-text endpoint."""
        async with httpx.AsyncClient(timeout=ANALYSIS_TIMEOUT) as client:
            for attempt in range(ANALYSIS_RETRIES):
                try:
                    safe_filename = os.path.basename(filename) if filename else "audio.wav"
                    safe_content_type = content_type or "audio/wav"
                    data_payload: Dict[str, str] = {
                        "text": text,
                        "test_type": test_type,
                        "language": language,
                    }
                    if expected_phonemes:
                        data_payload["expected_phonemes"] = expected_phonemes
                    if targets_json:
                        data_payload["targets_json"] = targets_json

                    response = await client.post(
                        f"{ANALYSIS_BACKEND_URL}/api/v1/analyze-text",
                        files={"file": (safe_filename, audio_bytes, safe_content_type)},
                        data=data_payload
                    )
                    response.raise_for_status()
                    return response.json()
                except Exception as e:
                    if attempt < ANALYSIS_RETRIES - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        raise HTTPException(status_code=503, detail=f"Analysis backend error: {e}")
        raise HTTPException(status_code=503, detail="Analysis backend unavailable")

    @staticmethod
    async def analyze_practice(
        audio_bytes: bytes,
        text: str,
        expected_phonemes: str,
        language: str = "english",
        filename: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Call CAM's /analyze-practice endpoint for isolated practice words.
        """
        async with httpx.AsyncClient(timeout=ANALYSIS_TIMEOUT) as client:
            for attempt in range(ANALYSIS_RETRIES):
                try:
                    safe_filename = os.path.basename(filename) if filename else "audio.wav"
                    safe_content_type = content_type or "audio/wav"
                    response = await client.post(
                        f"{ANALYSIS_BACKEND_URL}/api/v1/analyze-practice",
                        files={"file": (safe_filename, audio_bytes, safe_content_type)},
                        data={
                            "text": text,
                            "expected_phonemes": expected_phonemes,
                            "language": language,
                        }
                    )
                    response.raise_for_status()
                    return response.json()
                except Exception as e:
                    if attempt < ANALYSIS_RETRIES - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        raise HTTPException(status_code=503, detail=f"Analysis backend error: {e}")
        raise HTTPException(status_code=503, detail="Analysis backend unavailable")

    @staticmethod
    async def _call_backend(
        audio_bytes: bytes,
        sentence_id: str,
        test_type: str,
        language: str = "english",
        targets_json: Optional[str] = None,
        filename: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Call real Clario Analysis Backend with retry logic.

        Args:
            audio_bytes: Binary audio data
            sentence_id: Sentence ID
            test_type: Test type context
            language: Language of audio

        Returns:
            Raw analysis response from backend

        Raises:
            HTTPException if all retries fail
        """
        async with httpx.AsyncClient(timeout=ANALYSIS_TIMEOUT) as client:
            for attempt in range(ANALYSIS_RETRIES):
                try:
                    logger.info(
                        f"🔄 Backend call attempt {attempt + 1}/{ANALYSIS_RETRIES}: "
                        f"{ANALYSIS_BACKEND_URL}"
                    )

                    data_payload = {
                        "sentence_id": sentence_id,
                        "test_type": test_type,
                        "language": language,
                    }
                    if targets_json:
                        data_payload["targets_json"] = targets_json

                    safe_filename = os.path.basename(filename) if filename else "audio.wav"
                    safe_content_type = content_type or "audio/wav"

                    response = await client.post(
                        f"{ANALYSIS_BACKEND_URL}/api/v1/analyze",
                        files={"file": (safe_filename, audio_bytes, safe_content_type)},
                        data=data_payload
                    )

                    response.raise_for_status()
                    result = response.json()

                    logger.info(f"✅ Backend response: {sentence_id}")
                    return result

                except httpx.RequestError as e:
                    if attempt < ANALYSIS_RETRIES - 1:
                        # Exponential backoff: 1s, 2s, 4s
                        wait_time = 2 ** attempt
                        logger.warning(
                            f"Retry {attempt + 1} in {wait_time}s "
                            f"({sentence_id}): {e}"
                        )
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(f"All retries exhausted for {sentence_id}")
                        raise HTTPException(
                            status_code=503,
                            detail="Analysis backend unavailable (all retries failed)"
                        )

                except httpx.HTTPStatusError as e:
                    status = e.response.status_code
                    # Retry on server-side transient errors (5xx); fail fast on 4xx
                    if status >= 500 and attempt < ANALYSIS_RETRIES - 1:
                        wait_time = 2 ** attempt
                        logger.warning(
                            f"Backend returned {status}, retry {attempt + 1} in {wait_time}s"
                        )
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(f"Backend error {status}: {e}")
                        raise HTTPException(
                            status_code=503,
                            detail=f"Analysis backend error: {status}"
                        )

        # Safety: unreachable if ANALYSIS_RETRIES >= 1, but keeps the type-checker happy
        raise HTTPException(status_code=503, detail="Analysis backend unavailable")

    @staticmethod
    async def _parse_polymorphic_errors(
        raw_analysis: Dict[str, Any],
        sentence_id: str,
        test_type: str,
        mode: str,
        language: str
    ) -> List[FlaggedWordUnion]:
        """
        Parse backend response into polymorphic error objects.
        Handles different error types and mode-dependent fields.

        Mode behavior:
        - "efficient": Omit assistant_text and assistant_audio_url
        - "assistant": Include full coaching data

        Args:
            raw_analysis: Raw backend response
            sentence_id: For logging
            test_type: For coaching context
            mode: Response verbosity mode
            language: For TTS generation

        Returns:
            List of polymorphic error objects
        """
        flagged_words = []

        # Collect (raw_event, sub_test_type) pairs.
        # For comprehensive, iterate over all sub-test keys in results.
        raw_results = raw_analysis.get("results", {})
        # "comprehensive" and "phonology" both run multiple sub-tests and key the
        # results dict by sub-test name (e.g. "velar_fronting", "cluster_reduction").
        # Any other test_type (e.g. "velar_fronting" alone) keys the result directly.
        if test_type in ("comprehensive", "phonology"):
            sub_events = [
                (ev, sub_type)
                for sub_type, sub_result in raw_results.items()
                for ev in sub_result.get("events", [])
            ]
        else:
            sub_events = [
                (ev, test_type)
                for ev in raw_results.get(test_type, {}).get("events", [])
            ]

        logger.info(f"📋 Parsing {len(sub_events)} errors for {sentence_id}")

        for event, sub_test_type in sub_events:
            # Normalize Analysis Module fields to UAB expected shape
            normalized = AnalysisService._normalize_event(event, sub_test_type)

            # Generate coaching BEFORE construction — Pydantic v2 models are immutable
            if mode == "assistant":
                # tts_text  → fed into synthesizer (Urdu script with comma-pause hints)
                # display_text → sent to the frontend in assistant_text
                tts_text, display_text = AnalysisService._coaching_text(normalized, language=language)
                try:
                    tts_lang = LANGUAGE_MAP.get(language, "en")
                    # Urdu edge-tts reads better at a slightly slower rate
                    tts_rate = "-15%" if tts_lang == "ur" else "+0%"
                    coaching_bytes = await TTSService.synthesize_to_bytes(
                        tts_text,
                        lang=tts_lang,
                        gender="f",
                        rate=tts_rate,
                    )
                    if coaching_bytes:
                        from utils.audio_utils import audio_mime_type
                        mime = audio_mime_type(coaching_bytes)
                        coaching_url_str = (
                            f"data:{mime};base64,"
                            f"{base64.b64encode(coaching_bytes).decode()}"
                        )
                    else:
                        coaching_url_str = None
                except Exception as e:
                    logger.warning(f"Failed to generate coaching audio: {e}")
                    coaching_url_str = None
                normalized["assistant_text"] = display_text
                normalized["assistant_audio_url"] = coaching_url_str
            else:
                normalized["assistant_text"] = None
                normalized["assistant_audio_url"] = None

            # Build immutable Pydantic object with coaching already injected
            error_obj = AnalysisService._create_polymorphic_error(normalized)
            flagged_words.append(error_obj)

        logger.info(f"✅ Parsed {len(flagged_words)} polymorphic errors")
        return flagged_words

    @staticmethod
    def _coaching_text(normalized: Dict[str, Any], language: str = "english") -> tuple:
        """
        Returns (tts_text, display_text).

        tts_text    — fed directly into the TTS synthesizer.
                      English: plain text with commas around sounds for natural pauses.
                      Urdu: Arabic script with Urdu comma (،) and danda (۔) pause hints
                      so edge-tts (UzmaNeural) phrases naturally, like a speech therapist.

        display_text — sent in assistant_text to the frontend.
                      English: same as tts_text.
                      Urdu: romanized transliteration for readable on-screen display.

        No LLM or external calls — pure template logic.
        """
        category = normalized.get("error_category", "")
        etype    = normalized.get("type", "")
        word     = normalized.get("word", "")
        # Normalize "Velar Fronting" → "velar_fronting" to match Analysis Module Title Case output
        process  = normalized.get("process", "").lower().replace(" ", "_")
        is_urdu  = language == "urdu"

        # ── PHONOLOGY ────────────────────────────────────────────────────────
        if category == "phonology":
            expected = normalized.get("expected", "")
            detected = normalized.get("detected", "")

            if process == "epenthesis":
                en = (
                    f"I detected an extra sound. "
                    f"In the word, {word}. You said, {detected}. Instead of, {word}."
                )
                ur_tts = (
                    f"میں نے لفظ، {word}، میں ایک اضافی آواز سنی۔"
                )
                ur_rom = (
                    f"Mein ne lafz, {word}, mein aik izafi awaaz suni."
                )

            elif process == "cluster_reduction":
                en = (
                    f"You omitted the, {expected}, sound. "
                    f"In the word, {word}. And said, {detected}."
                )
                ur_tts = (
                    f"آپ نے، {expected}، کی آواز چھوڑ دی۔ "
                    f"لفظ، {word}، میں۔ اور، {detected}، کہا۔"
                )
                ur_rom = (
                    f"Aap ne, {expected}, ki awaaz chhod di. "
                    f"Lafz, {word}, mein. Aur, {detected}, kaha."
                )

            elif process == "velar_fronting":
                en = (
                    f"In the word, {word}. "
                    f"There should have been a, {expected}, sound. But I heard, {detected}."
                )
                ur_tts = (
                    f"لفظ، {word}، میں۔ "
                    f"، {expected}، کی آواز آنی چاہیے تھی۔ لیکن میں نے، {detected}، سنی۔"
                )
                ur_rom = (
                    f"Lafz, {word}, mein. "
                    f", {expected}, ki awaaz aani chahiye thi. Lekin mein ne, {detected}, suni."
                )

            elif process == "stopping":
                en = (
                    f"In the word, {word}. "
                    f"There should have been a flowing, {expected}, sound. But I heard, {detected}."
                )
                ur_tts = (
                    f"لفظ، {word}، میں۔ "
                    f"، {expected}، کی آواز آنی چاہیے تھی۔ لیکن میں نے، {detected}، سنی۔"
                )
                ur_rom = (
                    f"Lafz, {word}, mein. "
                    f", {expected}, ki awaaz aani chahiye thi. Lekin mein ne, {detected}, suni."
                )

            elif process == "gliding":
                en = (
                    f"In the word, {word}. "
                    f"There should have been an, {expected}, sound. But I heard, {detected}."
                )
                ur_tts = (
                    f"لفظ، {word}، میں۔ "
                    f"، {expected}، کی آواز آنی چاہیے تھی۔ لیکن میں نے، {detected}، سنی۔"
                )
                ur_rom = (
                    f"Lafz, {word}, mein. "
                    f", {expected}, ki awaaz aani chahiye thi. Lekin mein ne, {detected}, suni."
                )

            else:
                # Generic substitution / omission
                if detected:
                    en = (
                        f"In the word, {word}. "
                        f"There should have been a, {expected}, sound. But I heard, {detected}."
                    )
                    ur_tts = (
                        f"لفظ، {word}، میں۔ "
                        f"، {expected}، کی آواز آنی چاہیے تھی۔ لیکن میں نے، {detected}، سنی۔"
                    )
                    ur_rom = (
                        f"Lafz, {word}, mein. "
                        f", {expected}, ki awaaz aani chahiye thi. Lekin mein ne, {detected}, suni."
                    )
                else:
                    en = (
                        f"In the word, {word}. "
                        f"I couldn't quite catch the, {expected}, sound. Try saying it more clearly."
                    )
                    ur_tts = (
                        f"لفظ، {word}، میں۔ "
                        f"، {expected}، کی آواز واضح نہیں سنی۔"
                    )
                    ur_rom = (
                        f"Lafz, {word}, mein. "
                        f", {expected}, ki awaaz wazeh nahi suni."
                    )

            return (ur_tts, ur_rom) if is_urdu else (en, en)

        # ── FLUENCY ──────────────────────────────────────────────────────────
        elif category == "fluency":

            if etype == "prolongation":
                phoneme     = normalized.get("phoneme_prolonged", "")
                duration_ms = normalized.get("duration_ms", 0)
                en = f"I noticed a long stretch. On the, {phoneme}, sound. In the word, {word}."
                if duration_ms > 800:
                    en += " Try to move through it a little more quickly."
                ur_tts = (
                    f"میں نے ایک لمبا کھنچاؤ محسوس کیا۔ "
                    f"لفظ، {word}، میں۔ ، {phoneme}، کی آواز پر۔"
                )
                ur_rom = (
                    f"Mein ne ek lamba khinchao mahsoos kiya. "
                    f"Lafz, {word}, mein., {phoneme}, ki awaaz par."
                )
                return (ur_tts, ur_rom) if is_urdu else (en, en)

            elif etype == "stutter":
                phonemes = normalized.get("phonemes_stuttered", [])
                count    = normalized.get("repetition_count", 0)
                sound    = phonemes[0] if phonemes else ""
                if sound:
                    count_note = " A few times." if count > 1 else ""
                    en = (
                        f"I heard a slight bounce. "
                        f"On the, {sound}, sound. In the word, {word}.{count_note}"
                    )
                    ur_tts = (
                        f"میں نے ایک ہلکی سی تکرار سنی۔ "
                        f"لفظ، {word}، میں۔ ، {sound}، کی آواز پر۔"
                    )
                    ur_rom = (
                        f"Mein ne ek halki si takraar suni. "
                        f"Lafz, {word}, mein., {sound}, ki awaaz par."
                    )
                else:
                    en = f"I heard a slight bounce. In the word, {word}."
                    ur_tts = f"میں نے ایک ہلکی سی تکرار سنی۔ لفظ، {word}، میں۔"
                    ur_rom = f"Mein ne ek halki si takraar suni. Lafz, {word}, mein."
                return (ur_tts, ur_rom) if is_urdu else (en, en)

            elif etype == "block":
                preceding   = normalized.get("preceding_phoneme", "")
                duration_ms = normalized.get("block_duration_ms", 0)
                if preceding:
                    en = (
                        f"It sounded like you got stuck. "
                        f"After, {preceding}. In the word, {word}."
                    )
                    ur_tts = (
                        f"ایسا لگا جیسے آپ کی آواز رک گئی۔ "
                        f"لفظ، {word}، میں۔ ، {preceding}، کے بعد۔"
                    )
                    ur_rom = (
                        f"Aisa laga jaise aap ki awaaz ruk gayi. "
                        f"Lafz, {word}, mein., {preceding}, ke baad."
                    )
                else:
                    en = f"There was a block. On the word, {word}."
                    ur_tts = f"ایسا لگا جیسے آپ کی آواز رک گئی۔ لفظ، {word}، پر۔"
                    ur_rom = f"Aisa laga jaise aap ki awaaz ruk gayi. Lafz, {word}, par."
                return (ur_tts, ur_rom) if is_urdu else (en, en)

        # ── FALLBACK ─────────────────────────────────────────────────────────
        en     = f"There was an issue. With the word, {word}."
        ur_tts = f"لفظ، {word}، میں کچھ مسئلہ تھا۔"
        ur_rom = f"Lafz, {word}, mein kuch masla tha."
        return (ur_tts, ur_rom) if is_urdu else (en, en)

    @staticmethod
    def _normalize_event(event: Dict[str, Any], sub_test_type: str) -> Dict[str, Any]:
        """
        Translate Analysis Module event shape into the flat shape expected by
        _create_polymorphic_error.

        Analysis Module emits per-detector shapes:
          blocks      → {type: "BlockBetweenWords", duration, prev_word, next_word, word}
          prolongation → {phone, duration, word_context}
          repetition  → {type: "WordRepetition", unit, count, word_context}
          phonology   → {process, word, expected, heard}

        UAB expects:
          blocks      → {error_category:"fluency", type:"block", block_duration_ms, preceding_phoneme, word}
          prolongation → {error_category:"fluency", type:"prolongation", phoneme_prolonged, duration_ms, word}
          repetition  → {error_category:"fluency", type:"stutter", phonemes_stuttered, repetition_count, word}
          phonology   → {error_category:"phonology", type:"substitution", expected, detected, word}
        """
        norm: Dict[str, Any] = dict(event)
        norm.setdefault("index_in_sentence", 0)

        if sub_test_type == "blocks":
            norm["error_category"] = "fluency"
            norm["type"] = "block"
            norm["process"] = "blocks"
            norm["block_duration_ms"] = int(event.get("duration", 0) * 1000)
            # Use prev_word for between-words blocks, word for within-word blocks
            norm["preceding_phoneme"] = event.get("prev_word") or event.get("word")
            norm["word"] = event.get("prev_word") or event.get("word") or ""

        elif sub_test_type == "prolongation":
            norm["error_category"] = "fluency"
            norm["type"] = "prolongation"
            norm["process"] = "prolongation"
            norm["phoneme_prolonged"] = event.get("phone", "")
            norm["duration_ms"] = int(event.get("duration", 0) * 1000)
            norm["word"] = event.get("word_context", "")

        elif sub_test_type == "repetition":
            norm["error_category"] = "fluency"
            norm["type"] = "stutter"
            norm["process"] = "repetition"
            unit = event.get("unit", "")
            norm["phonemes_stuttered"] = [unit] if unit else []
            norm["repetition_count"] = int(event.get("count", 0))
            norm["word"] = event.get("word_context", "")

        else:
            # Phonological process: velar_fronting, stopping, gliding,
            # cluster_reduction, epenthesis — store sub_test_type as `process`
            # so TensorBridge can select the correct error column.
            norm["error_category"] = "phonology"
            norm["type"] = "substitution"
            norm["process"] = sub_test_type          # ← e.g. "stopping"
            norm["detected"] = event.get("heard", "")
            # "expected" and "word" already present in the phonology event

        return norm

    @staticmethod
    def _create_polymorphic_error(event: Dict[str, Any]) -> FlaggedWordUnion:
        """
        Factory method to create appropriate error object type.

        Args:
            event: Raw error event from backend

        Returns:
            Polymorphic error object (one of 4 types)

        Raises:
            ValueError if error type is unknown
        """
        error_category = event.get("error_category", "unknown")
        error_type = event.get("type", "unknown")
        word = event.get("word", "")
        index = event.get("index_in_sentence", 0)

        try:
            asst_text  = event.get("assistant_text")
            asst_audio = event.get("assistant_audio_url")

            if error_category == "phonology":
                # Phonology: Substitution, Omission, Addition
                return PhonologyError(
                    word=word,
                    index_in_sentence=index,
                    error_category="phonology",
                    error_type=error_type,
                    process=event.get("process"),         # ← e.g. "stopping"
                    expected_phoneme=event.get("expected", ""),
                    heard_phoneme=event.get("detected", ""),
                    assistant_text=asst_text,
                    assistant_audio_url=asst_audio,
                )

            elif error_category == "fluency":
                if error_type == "prolongation":
                    return ProlongationError(
                        word=word,
                        index_in_sentence=index,
                        error_category="fluency",
                        error_type="prolongation",
                        phoneme_prolonged=event.get("phoneme_prolonged", ""),
                        duration_ms=int(event.get("duration_ms", 0)),
                        assistant_text=asst_text,
                        assistant_audio_url=asst_audio,
                    )

                elif error_type == "stutter":
                    return StutterError(
                        word=word,
                        index_in_sentence=index,
                        error_category="fluency",
                        error_type="stutter",
                        phonemes_stuttered=event.get("phonemes_stuttered", []),
                        repetition_count=int(event.get("repetition_count", 0)),
                        assistant_text=asst_text,
                        assistant_audio_url=asst_audio,
                    )

                elif error_type == "block":
                    return BlockError(
                        word=word,
                        index_in_sentence=index,
                        error_category="fluency",
                        error_type="block",
                        block_duration_ms=int(event.get("block_duration_ms", 0)),
                        preceding_phoneme=event.get("preceding_phoneme"),
                        assistant_text=asst_text,
                        assistant_audio_url=asst_audio,
                    )

                else:
                    logger.warning(f"🤷 Unknown fluency error type: {error_type}")
                    # Default to stutter
                    return StutterError(
                        word=word,
                        index_in_sentence=index,
                        error_category="fluency",
                        error_type="stutter",
                        phonemes_stuttered=[],
                        repetition_count=0,
                        assistant_text=asst_text,
                        assistant_audio_url=asst_audio,
                    )

            else:
                logger.warning(f"🤷 Unknown error category: {error_category}")
                # Default to phonology substitution
                return PhonologyError(
                    word=word,
                    index_in_sentence=index,
                    error_category="phonology",
                    error_type="substitution",
                    expected_phoneme="?",
                    heard_phoneme="?",
                    assistant_text=asst_text,
                    assistant_audio_url=asst_audio,
                )

        except Exception as e:
            logger.error(f"❌ Error creating polymorphic object: {e}")
            raise ValueError(f"Failed to parse error: {e}")
