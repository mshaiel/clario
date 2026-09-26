import os
import re
import logging
from difflib import SequenceMatcher
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import JSONResponse

from api.schema import (
    AnalysisResponse, TestType, Language, PacingResponse,
    create_error_response, validate_audio_file_extension,
)
from core.pipeline_manager import get_pipeline_manager
from core.asr_models import get_asr_loader
from core.utils_audio import save_upload_to_temp

router = APIRouter()
logger = logging.getLogger("API")


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    sentence_id: str = Form(...),
    test_type: TestType = Form(...),
    language: Language = Form(Language.ENGLISH),
    targets_json: str = Form(None),
):
    """
    Main analysis endpoint.
    Accepts audio, runs the pipeline, and returns clinical analysis.
    """
    temp_path = None
    try:
        logger.info(f"🎤 Received request: {sentence_id} [{test_type}] Lang: {language}")

        # 1. Validate file extension
        filename = file.filename or "upload.wav"
        if not validate_audio_file_extension(filename):
            return JSONResponse(
                status_code=415,
                content=create_error_response(
                    f"Unsupported audio format: '{filename}'. "
                    "Allowed: wav, mp3, m4a, flac, ogg, aac, webm, 3gp",
                    error_code="UNSUPPORTED_FORMAT",
                ),
            )

        # 2. Save audio to temp file (async read)
        ext = os.path.splitext(filename)[1] or ".wav"
        temp_path = await save_upload_to_temp(file, suffix=ext)

        # 3. Run analysis pipeline
        manager = get_pipeline_manager()
        result = manager.analyze(
            audio_path=temp_path,
            sentence_id=sentence_id,
            test_type=test_type,
            language=language,
            targets_json=targets_json,
        )

        # 4. Schedule temp file cleanup
        background_tasks.add_task(cleanup_file, temp_path)

        if not result["success"]:
            return JSONResponse(
                status_code=422,
                content=create_error_response(result.get("error", "Unknown analysis error")),
            )

        return AnalysisResponse(**result)

    except Exception as e:
        logger.error(f"Endpoint error: {e}", exc_info=True)
        if temp_path:
            cleanup_file(temp_path)
        return JSONResponse(
            status_code=500,
            content=create_error_response(str(e), error_code="INTERNAL_ERROR"),
        )


@router.post("/analyze-text", response_model=AnalysisResponse)
async def analyze_text(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    text: str = Form(...),                          # The full sentence or word, e.g. "say cap"
    test_type: TestType = Form(...),                # Same test_type values as /analyze
    language: Language = Form(Language.ENGLISH),
    expected_phonemes: str = Form(None),            # Optional IPA string, e.g. "k æ p"
    targets_json: str = Form(None),                 # Optional JSON targets array from caller
):
    """
    Full-pipeline analysis endpoint for practice modules.
    Same as /analyze but accepts free text instead of a sentence_id.

    Use this when you have the sentence text and optionally its expected IPA,
    but no pre-baked sentence_id in the sentence bank — e.g. training exercises,
    carrier phrases, shadowing sentences generated at runtime.

    Internally converts (text, expected_phonemes) → targets_json and delegates
    to PipelineManager, so you get the same clinical SODA/fluency detectors as
    the assessment pipeline, not just a raw phoneme comparison.
    """
    import json as _json

    temp_path = None
    try:
        logger.info(f"🎤 analyze-text: '{text}' [{test_type}] lang={language}")

        # 1. Validate file extension
        filename = file.filename or "upload.wav"
        if not validate_audio_file_extension(filename):
            return JSONResponse(
                status_code=415,
                content=create_error_response(
                    f"Unsupported audio format: '{filename}'. "
                    "Allowed: wav, mp3, m4a, flac, ogg, aac, webm, 3gp",
                    error_code="UNSUPPORTED_FORMAT",
                ),
            )

        # 2. Save audio to temp file
        ext = os.path.splitext(filename)[1] or ".wav"
        temp_path = await save_upload_to_temp(file, suffix=ext)

        # 3. Build targets_json
        #    Prefer explicit targets_json; otherwise derive from expected_phonemes.
        #    Always provide at least an empty list so PipelineManager always creates
        #    a dynamic sentence regardless of word length or spaces in `text`.
        if targets_json:
            logger.info("🎯 Using provided targets_json")
        elif expected_phonemes:
            clean = expected_phonemes.replace("/", "").strip()
            ipa_list = [ph for ph in clean.split() if ph]
            if ipa_list:
                target_word = text.strip().split()[-1]
                targets_json = _json.dumps([{"word": target_word, "expected_ipa": ipa_list}])
                logger.info(f"🎯 Built targets_json: {targets_json}")
            else:
                targets_json = _json.dumps([])
        else:
            targets_json = _json.dumps([])   # empty → dynamic sentence, no SODA targets

        # 4. Run analysis pipeline
        manager = get_pipeline_manager()
        result = manager.analyze(
            audio_path=temp_path,
            sentence_id=text,
            test_type=test_type,
            language=language,
            targets_json=targets_json,
        )

        # 5. Schedule temp file cleanup
        background_tasks.add_task(cleanup_file, temp_path)

        if not result["success"]:
            return JSONResponse(
                status_code=422,
                content=create_error_response(result.get("error", "Unknown analysis error")),
            )

        return AnalysisResponse(**result)

    except Exception as e:
        logger.error(f"analyze-text error: {e}", exc_info=True)
        if temp_path:
            cleanup_file(temp_path)
        return JSONResponse(
            status_code=500,
            content=create_error_response(str(e), error_code="INTERNAL_ERROR"),
        )


@router.post("/analyze-practice")
async def analyze_practice_word(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    text: str = Form(...),                  # target word/phrase, e.g. "cap"
    expected_phonemes: str = Form(...),     # IPA phonemes, space-separated, e.g. "k æ p"
    language: Language = Form(Language.ENGLISH),
):
    """
    Practice pronunciation analysis endpoint.
    Accepts audio of a spoken word/phrase plus its expected phonemes.
    Returns accuracy_score and per-phoneme match breakdown.
    Does NOT require a sentence_id — works with arbitrary words from training exercises.
    """
    temp_path = None
    try:
        logger.info(f"🎤 analyze-practice: text='{text}' phonemes='{expected_phonemes}' lang={language}")

        # 1. Validate file extension
        filename = file.filename or "upload.wav"
        if not validate_audio_file_extension(filename):
            return JSONResponse(
                status_code=415,
                content=create_error_response(
                    f"Unsupported audio format: '{filename}'. "
                    "Allowed: wav, mp3, m4a, flac, ogg, aac, webm, 3gp",
                    error_code="UNSUPPORTED_FORMAT",
                ),
            )

        # 2. Save audio to temp file
        ext = os.path.splitext(filename)[1] or ".wav"
        temp_path = await save_upload_to_temp(file, suffix=ext)

        # 3. Run ASR — transcribe words to get what was said
        asr_loader = get_asr_loader()
        raw_words = asr_loader.transcribe_words(
            temp_path,
            use_phonology_settings=True,
            prompt=text,
            language=language,
        )
        transcript_str = " ".join([w["word"] for w in raw_words]) if raw_words else ""
        logger.info(f"📝 Transcript: '{transcript_str}'")

        # 4. Run Allosaurus for phoneme recognition
        raw_phones = asr_loader.recognize_phones(
            temp_path,
            need_accurate_timing=False,
            language=language,
        )
        heard_phones = [p["phone"] for p in raw_phones] if raw_phones else []
        logger.info(f"🔤 Heard phonemes: {heard_phones}")

        # 5. Align heard phonemes against expected phonemes
        clean_expected = expected_phonemes.replace("/", "")
        expected_list = [ph.strip() for ph in clean_expected.split() if ph.strip()]
        matcher = SequenceMatcher(None, expected_list, heard_phones)

        phoneme_matches = []
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for ph in expected_list[i1:i2]:
                    phoneme_matches.append({"expected": ph, "heard": ph, "correct": True})
            elif tag == "replace":
                from core.alignment import are_phones_similar
                for idx, ph in enumerate(expected_list[i1:i2]):
                    heard = heard_phones[j1 + idx] if (j1 + idx) < j2 else "?"
                    is_correct = False
                    if heard != "?":
                        is_correct = are_phones_similar(ph, heard, language=str(language.value))
                    phoneme_matches.append({"expected": ph, "heard": heard, "correct": is_correct})
            elif tag == "delete":
                from core.alignment import should_ignore_omission
                for idx, ph in enumerate(expected_list[i1:i2]):
                    is_correct = False
                    global_idx = i1 + idx
                    is_final = (global_idx == len(expected_list) - 1)
                    if should_ignore_omission(ph, is_final):
                        is_correct = True
                    elif global_idx > 0:
                        prev_ph = expected_list[global_idx - 1]
                        if ph == 'ʊ' and prev_ph in ['o', 'a', 'oʊ', 'aʊ', 'ə']:
                            is_correct = True
                        elif ph == 'ɪ' and prev_ph in ['a', 'e', 'ɔ', 'aɪ', 'eɪ', 'ɔɪ']:
                            is_correct = True
                    phoneme_matches.append({"expected": ph, "heard": "—", "correct": is_correct})
            # "insert" (extra phonemes heard) — ignored for scoring

        # 6. Compute accuracy
        correct_count = sum(1 for m in phoneme_matches if m["correct"])
        total = len(phoneme_matches) if phoneme_matches else 1
        accuracy_score = round((correct_count / total) * 100, 2)
        
        def _clean_word(w):
            return re.sub(r"[^\w\s]", "", w).strip().lower()
            
        if transcript_str and _clean_word(transcript_str) == _clean_word(text):
            logger.info(f"🎯 Transcript perfectly matches '{text}'. Forcing 100% accuracy.")
            accuracy_score = 100.0
            for m in phoneme_matches:
                m["correct"] = True

        logger.info(f"🎯 Practice accuracy: {accuracy_score}% ({correct_count}/{total})")

        # 7. Schedule cleanup
        background_tasks.add_task(cleanup_file, temp_path)

        return {
            "success": True,
            "test_type": "comprehensive",
            "sentence_id": "practice",
            "text": text,
            "language": str(language),
            "transcript": transcript_str,
            "accuracy_score": accuracy_score,
            "word_results": [],
            "results": {"phoneme_matches": phoneme_matches},
            "errors": None,
        }

    except Exception as e:
        logger.error(f"analyze-practice error: {e}", exc_info=True)
        if temp_path:
            cleanup_file(temp_path)
        return JSONResponse(
            status_code=500,
            content=create_error_response(str(e), error_code="INTERNAL_ERROR"),
        )



@router.post("/detect-phonemes")
async def detect_phonemes(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    expected_phonemes: str = Form(...),   # space-separated IPA, e.g. "k r eɪ"
    language: Language = Form(Language.ENGLISH),
):
    """
    Dedicated phoneme extraction endpoint for Syllable Chaining.

    Unlike /analyze-text and /analyze-practice this endpoint:
    - Skips Whisper entirely (no word-level transcription)
    - Runs Allosaurus directly on the audio for phoneme extraction
    - Compares detected phonemes against expected IPA targets
    - Returns per-phoneme match results compatible with PhonemeDetectResponse

    Used by the Syllable Chaining exercise to evaluate isolated chunk recordings
    where full ASR would hallucinate or crash on sub-word audio.
    """
    temp_path = None
    try:
        logger.info(
            f"🔍 detect-phonemes: expected='{expected_phonemes}' lang={language}"
        )

        # 1. Validate file extension
        filename = audio.filename or "upload.wav"
        if not validate_audio_file_extension(filename):
            return JSONResponse(
                status_code=415,
                content=create_error_response(
                    f"Unsupported audio format: '{filename}'. "
                    "Allowed: wav, mp3, m4a, flac, ogg, aac, webm, 3gp",
                    error_code="UNSUPPORTED_FORMAT",
                ),
            )

        # 2. Save audio to temp file
        ext = os.path.splitext(filename)[1] or ".wav"
        temp_path = await save_upload_to_temp(audio, suffix=ext)

        # 3. Run Allosaurus ONLY — skip Whisper entirely
        asr_loader = get_asr_loader()
        raw_phones = asr_loader.recognize_phones(
            temp_path,
            need_accurate_timing=False,
            language=language,
        )
        detected_phonemes = [p["phone"] for p in raw_phones] if raw_phones else []
        logger.info(f"🔤 Detected phonemes: {detected_phonemes}")

        # 4. Parse expected IPA targets
        clean_expected = expected_phonemes.replace("/", "").strip()
        expected_list = [ph.strip() for ph in clean_expected.split() if ph.strip()]
        logger.info(f"🎯 Expected phonemes: {expected_list}")

        # 5. Align detected phonemes against expected using SequenceMatcher + Leniency
        from core.alignment import are_phones_similar, should_ignore_omission
        matcher = SequenceMatcher(None, expected_list, detected_phonemes)
        phoneme_matches = []
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                for ph in expected_list[i1:i2]:
                    phoneme_matches.append({"expected": ph, "detected": ph, "correct": True})
            elif tag == "replace":
                for idx, ph in enumerate(expected_list[i1:i2]):
                    det = detected_phonemes[j1 + idx] if (j1 + idx) < j2 else "?"
                    is_correct = False
                    if det != "?":
                        is_correct = are_phones_similar(ph, det, language=str(language.value))
                    phoneme_matches.append({"expected": ph, "detected": det, "correct": is_correct})
            elif tag == "delete":
                for idx, ph in enumerate(expected_list[i1:i2]):
                    is_correct = False
                    global_idx = i1 + idx
                    is_final = (global_idx == len(expected_list) - 1)
                    if should_ignore_omission(ph, is_final):
                        is_correct = True
                    elif global_idx > 0:
                        prev_ph = expected_list[global_idx - 1]
                        if ph == 'ʊ' and prev_ph in ['o', 'a', 'oʊ', 'aʊ', 'ə']:
                            is_correct = True
                        elif ph == 'ɪ' and prev_ph in ['a', 'e', 'ɔ', 'aɪ', 'eɪ', 'ɔɪ']:
                            is_correct = True
                    phoneme_matches.append({"expected": ph, "detected": "—", "correct": is_correct})
            # "insert" (extra phonemes detected) — ignored for scoring

        # 6. Compute accuracy score
        correct_count = sum(1 for m in phoneme_matches if m["correct"])
        total = len(phoneme_matches) if phoneme_matches else 1
        accuracy_score = round((correct_count / total) * 100, 2)
        logger.info(
            f"✅ detect-phonemes accuracy: {accuracy_score}% ({correct_count}/{total})"
        )

        # 7. Schedule cleanup
        background_tasks.add_task(cleanup_file, temp_path)

        return {
            "detected_phonemes": detected_phonemes,
            "phoneme_matches": phoneme_matches,
            "accuracy_score": accuracy_score,
        }

    except Exception as e:
        logger.error(f"detect-phonemes error: {e}", exc_info=True)
        if temp_path:
            cleanup_file(temp_path)
        return JSONResponse(
            status_code=500,
            content=create_error_response(str(e), error_code="INTERNAL_ERROR"),
        )


@router.post("/analyze-pacing", response_model=PacingResponse)
async def analyze_pacing(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    expected_text: str = Form(...),
    target_wpm: float = Form(...),
    language: Language = Form(Language.ENGLISH),
):
    """
    Dedicated endpoint for Pacing exercises.
    Extracts word-level timestamps using Whisper and calculates actual active WPM
    and rhythm variance (consistency).
    """
    temp_path = None
    try:
        logger.info(
            f"⏱️ analyze-pacing: target_wpm={target_wpm} lang={language}"
        )

        # 1. Validate file extension
        filename = audio.filename or "upload.wav"
        if not validate_audio_file_extension(filename):
            return JSONResponse(
                status_code=415,
                content=create_error_response(
                    f"Unsupported audio format: '{filename}'",
                    error_code="UNSUPPORTED_FORMAT",
                ),
            )

        # 2. Save audio to temp file
        ext = os.path.splitext(filename)[1] or ".wav"
        temp_path = await save_upload_to_temp(audio, suffix=ext)

        # 3. Analyze pacing using the detector
        from detectors.pacing_detector import get_pacing_detector
        detector = get_pacing_detector()
        result = detector.analyze_pacing(
            audio_path=temp_path,
            expected_text=expected_text,
            target_wpm=target_wpm,
            language=str(language.value)
        )

        # 4. Schedule cleanup
        background_tasks.add_task(cleanup_file, temp_path)

        if not result["success"]:
            return JSONResponse(
                status_code=422,
                content=create_error_response(result.get("feedback", "Analysis failed")),
            )

        return PacingResponse(**result)

    except Exception as e:
        logger.error(f"analyze-pacing error: {e}", exc_info=True)
        if temp_path:
            cleanup_file(temp_path)
        return JSONResponse(
            status_code=500,
            content=create_error_response(str(e), error_code="INTERNAL_ERROR"),
        )


def cleanup_file(path: str):
    """Delete a temporary file, ignoring errors."""
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
