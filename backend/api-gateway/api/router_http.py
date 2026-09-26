"""
HTTP Router for Unified Assistant Backend (UAB)
Stateless REST API endpoints serving frontend with OTA content and audio analysis.
"""
import base64
import os
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, Response
from typing import Dict, Any, Optional, List
import httpx

from api.schemas import (
    QuestionnaireRequest, QuestionnaireResponse,
    AssessmentsResponse,
    AnalyzeAudioResponse,
    ValidateSessionRequest, ValidateSessionResponse,
    TTSGenerateRequest, TTSGenerateResponse,
    GenerateTrainingRequest, GenerateTrainingResponse,
    TrainingModule, TrainingModulesResponse,
)
from services.firestore_service import FirestoreService
from services.analysis_service import AnalysisService
from services.tts_service import TTSService
from services.training_service import TrainingService
from services.training_bundle_service import build_training_bundle
from core.recommender import recommender
from utils.logger import get_logger, LANGUAGE_MAP
from utils.audio_utils import audio_mime_type as _audio_mime_type

logger = get_logger("HTTPRouter")
router = APIRouter()

# ── CTkM proxy config ──────────────────────────────────────────────────────
_CTMK = os.getenv('CTMK_URL', 'https://mshaiel2004-clario-techniques-module.hf.space')
_CTMK_TIMEOUT = 60.0


# ==========================================
# 1. Profile & Onboarding
# ==========================================

@router.post("/profile/questionnaire", response_model=QuestionnaireResponse)
async def submit_questionnaire(req: QuestionnaireRequest) -> QuestionnaireResponse:
    """
    Submits user's onboarding questionnaire and initiates clinical diagnosis.
    The UAB acts as sole clinical diagnostician, assigning appropriate assessments.
    Assessment plans (data.json content) are built and stored in memory — no file I/O.
    """
    logger.info(f"📝 Questionnaire received for {req.user_id} (Language: {req.language})")

    # 1. Save user profile to Firestore
    success = await FirestoreService.save_questionnaire(req)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save profile data.")

    # 2. Assign assessments and build assessment plans
    success = await FirestoreService.assign_assessments(
        user_id=req.user_id,
        selections=req.selections,
        language=req.language
    )

    if not success:
        logger.warning(f"⚠️ Assessment plan building had issues for {req.user_id}, but not blocking")

    logger.info(f"✅ Assessments assigned for {req.user_id}")
    return QuestionnaireResponse(
        success=True,
        message="Profile created. Assessment plans built and ready to download."
    )


# ==========================================
# 2. OTA Manifest: Assessments
# ==========================================

@router.get("/assessments", response_model=AssessmentsResponse)
async def get_assessments(
    user_id: str = Query(...),
    language: Optional[str] = Query(None, description="Filter by language: 'english' or 'urdu'")
) -> AssessmentsResponse:
    """
    Returns list of assessments assigned to user.
    No download_url — bundles are fetched via GET /assessments/{id}/bundle.
    
    Args:
        user_id: User identifier
        language: Optional language filter ('english' or 'urdu'). If omitted, returns all assessments.
    """
    logger.info(f"📋 Fetching assessments for {user_id} (language: {language or 'all'})")
    assessments = await FirestoreService.get_user_assessments(user_id, language=language)
    return AssessmentsResponse(assessments=assessments)


@router.get("/assessments/{assess_id}/bundle")
async def download_assessment_bundle(
    assess_id: str,
    user_id: str = Query(...)
):
    """
    Returns a ZIP bundle containing data.json + all audio assets for one assessment.

    The ZIP is assembled on-demand from pre-existing static files:
    - data.json             — assessment manifest
    - audio/sentence/*.wav  — sentence-level audio
    - audio/word/*.wav      — word-level audio
    - audio/assistant/*.mp3 — assistant voice lines (intro/validation/etc.)

    Frontend downloads once, extracts to local cache, and resolves all audio paths
    from the relative paths embedded in data.json.

    Args:
        assess_id: e.g., "assess_velar_fronting_v1"
        user_id:   User whose plan should be used
    """
    logger.info(f"📥 Bundle request: {assess_id} for user {user_id}")

    plan = await FirestoreService.get_assessment_plan(user_id, assess_id)
    if not plan:
        raise HTTPException(
            status_code=404,
            detail=f"Assessment plan not found for user '{user_id}', id '{assess_id}'. "
                   "Submit the questionnaire first."
        )

    language = plan.get("language", "english")

    try:
        zip_bytes = await recommender.build_assessment_bundle(plan, language)
    except Exception as e:
        logger.error(f"❌ Bundle assembly failed for {assess_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Bundle assembly failed: {str(e)}")

    if not zip_bytes:
        raise HTTPException(status_code=500, detail="Bundle is empty — audio files may be missing.")

    logger.info(f"✅ Serving bundle: {assess_id} ({len(zip_bytes):,} bytes)")
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{assess_id}.zip"'}
    )


# ==========================================
# 3. Stateless Audio Analysis
# ==========================================


@router.post("/assistant/analyze", response_model=AnalyzeAudioResponse)
async def analyze_audio(
    audio: UploadFile = File(...),
    sentence_id: str = Form(...),
    test_type: str = Form(...),
    mode: str = Form(default="assistant"),
    language: str = Form(default="english"),
    targets_json: Optional[str] = Form(None)
) -> AnalyzeAudioResponse:
    """
    Analyzes a single sentence's audio in isolation (stateless).

    Request: multipart/form-data with audio binary + metadata fields
    Response: Polymorphic error array with optional coaching (mode-dependent)

    Mode Parameter:
    - "efficient": Omit assistant_text and assistant_audio_url (save latency)
    - "assistant": Include dynamic AI coaching text and TTS audio URL

    This is a PURE FUNCTION: Same input always produces same results.
    No session state is maintained on the server.
    """
    logger.info(f"🎤 Analyzing {sentence_id} [{test_type}] - Mode: {mode}")

    # Validate mode parameter
    if mode not in ["efficient", "assistant"]:
        raise HTTPException(
            status_code=400,
            detail="Mode must be 'efficient' or 'assistant'"
        )

    # 1. Read audio bytes
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    # 2. Call Analysis Service (delegates to real backend or mock)
    analysis_result = await AnalysisService.analyze_audio(
        audio_bytes=audio_bytes,
        sentence_id=sentence_id,
        test_type=test_type,
        mode=mode,
        language=language,
        targets_json=targets_json,
        filename=audio.filename,
        content_type=audio.content_type
    )

    logger.info(f"Analysis complete: {sentence_id} - Accuracy: {analysis_result.sentence_accuracy}%")

    return analysis_result
    
@router.post("/assistant/analyze-practice")
async def analyze_practice_word(
    file: UploadFile = File(...),
    text: str = Form(...),
    expected_phonemes: str = Form(...),
    language: str = Form(default="english")
):
    """
    Proxy to CAM's analyze-practice endpoint for isolated words.
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")
        
    return await AnalysisService.analyze_practice(
        audio_bytes=audio_bytes,
        text=text,
        expected_phonemes=expected_phonemes,
        language=language,
        filename=file.filename,
        content_type=file.content_type
    )


@router.post("/assistant/analyze-text", response_model=AnalyzeAudioResponse)
async def analyze_text(
    audio: UploadFile = File(...),
    text: str = Form(...),
    test_type: str = Form(...),
    mode: str = Form(default="efficient"),
    language: str = Form(default="english"),
    expected_phonemes: Optional[str] = Form(None),
    targets_json: Optional[str] = Form(None)
) -> AnalyzeAudioResponse:
    """
    Full-pipeline analysis accepting free text instead of a sentence_id.
    Proxies to CAM's /analyze-text endpoint.

    Use for practice modules where the sentence was generated at runtime
    (carrier phrases, shadowing, minimal pairs) and no sentence bank entry exists.
    Returns the same AnalyzeAudioResponse as /assistant/analyze.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")
    if not expected_phonemes and not targets_json:
        raise HTTPException(status_code=422, detail="expected_phonemes or targets_json is required")

    return await AnalysisService.analyze_text(
        audio_bytes=audio_bytes,
        text=text,
        test_type=test_type,
        mode=mode,
        language=language,
        expected_phonemes=expected_phonemes,
        targets_json=targets_json,
        filename=audio.filename,
        content_type=audio.content_type
    )


# ==========================================
# 4. Batch Validation & Active Learning
# ==========================================

@router.post("/assistant/validate-session", response_model=ValidateSessionResponse)
async def validate_session(req: ValidateSessionRequest) -> ValidateSessionResponse:
    """
    Batch validation endpoint: User submits all errors they've confirmed
    after completing a full assessment/practice session.

    This is the "ground truth" submission point for active learning:
    - Frontend has shown errors to user
    - User has manually validated (removed False Positives)
    - Now we update the ML tensor with confirmed errors

    Receives:
    - test_id: Which assessment was completed
    - overall_session_accuracy: Average accuracy across all sentences
    - validated_errors: Array of errors user confirmed (False Positives removed)

    Returns:
    - success: Whether the validation was processed
    - tensor_updated: Whether user's learning tensor was updated
    """
    logger.info(
        f"Validating session {req.test_id} "
        f"with {len(req.validated_errors)} confirmed errors (user: {req.user_id})"
    )

    # process_batch_validation returns True only when ALL sub-steps (including
    # tensor update) succeed, so tensor_updated reflects the actual outcome.
    success = await FirestoreService.process_batch_validation(
        user_id=req.user_id,
        validation_data=req
    )

    if not success:
        raise HTTPException(
            status_code=500,
            detail="Failed to process session validation"
        )

    logger.info(f"Session {req.test_id} validated and tensor updated")

    return ValidateSessionResponse(
        success=True,
        message="Session validated and learning profile updated.",
        tensor_updated=success
    )


# ==========================================
# 5. Dynamic TTS Generation
# ==========================================

@router.post("/tts/generate", response_model=TTSGenerateResponse)
async def generate_tts(req: TTSGenerateRequest) -> TTSGenerateResponse:
    """
    Generates TTS audio dynamically for coaching text.
    
    Uses Coqui XTTS v2 for high-quality premium audio.
    Fallback to edge-tts if Coqui unavailable.
    
    Request:
    {
        "text": "Great job! Try again.",
        "language": "english",
        "gender": "m"
    }
    
    Response:
    {
        "success": true,
        "message": "Audio generated successfully",
        "audio_url": "data:audio/wav;base64,...",
        "duration_ms": 2340
    }
    """
    if not req.text or len(req.text.strip()) == 0:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if req.language not in LANGUAGE_MAP:
        raise HTTPException(status_code=400, detail="Language must be 'english' or 'urdu'")

    if req.gender not in ["m", "f"]:
        raise HTTPException(status_code=400, detail="Gender must be 'm' or 'f'")

    logger.info(f"Generating TTS: '{req.text[:50]}...' ({req.language}, {req.gender})")

    try:
        tts_lang = LANGUAGE_MAP[req.language]

        audio_bytes = await TTSService.synthesize_to_bytes(
            text=req.text,
            lang=tts_lang,
            gender=req.gender,
            use_coqui=True,
            retries=2
        )

        if not audio_bytes:
            raise HTTPException(
                status_code=500,
                detail="TTS generation failed. Please try again."
            )

        estimated_duration_ms = max(500, int((len(req.text) / 150) * 1000))
        mime_type = _audio_mime_type(audio_bytes)
        audio_url = f"data:{mime_type};base64,{base64.b64encode(audio_bytes).decode('utf-8')}"

        logger.info(f"TTS generated: {len(audio_bytes)} bytes ({mime_type})")

        return TTSGenerateResponse(
            success=True,
            message="Audio generated successfully",
            audio_url=audio_url,
            duration_ms=estimated_duration_ms
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS generation error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"TTS generation failed: {str(e)}"
        )


# ==========================================
# 6. Health & Metadata
# ==========================================

@router.get("/health")
async def health() -> Dict[str, Any]:
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "UAB-HTTP",
        "version": "2.0.0"
    }


# ==========================================
# 7. Exercise Strategy / Training Modules
# ==========================================

@router.post("/training/generate", response_model=GenerateTrainingResponse)
async def generate_training(req: GenerateTrainingRequest) -> GenerateTrainingResponse:
    """
    Generate a personalised exercise strategy for a user.

    Reads the user's current ML tensor from Firestore, auto-derives UserStats,
    calls CTM /strategy/generate, flattens the result into per-disorder modules,
    and stores them in Firestore under users/{user_id}/training_plans.

    Frontend should call this after completing all assessment modules.
    """
    logger.info(f"🎯 Training generate: user={req.user_id} lang={req.language}")

    # 1. Fetch tensor + user profile from Firestore
    current_tensor = await FirestoreService.get_user_tensor(req.user_id)
    user_doc = await FirestoreService.get_user_profile(req.user_id)
    target_persona = user_doc.get("target_persona", "child") if user_doc else "child"

    if current_tensor is None:
        raise HTTPException(
            status_code=422,
            detail="No learning tensor found. Complete at least one assessment session first.",
        )

    # 3. Call CTM
    try:
        ctm_response = await TrainingService.generate_strategy(
            current_tensor=current_tensor,
            user_stats=req.user_stats.model_dump(),
            language=req.language,
            force_easier=req.force_easier,
        )
    except RuntimeError as e:
        logger.error(f"❌ CTM strategy/generate failed: {e}")
        raise HTTPException(status_code=503, detail=f"Training module unavailable: {e}")

    if ctm_response is None:
        return GenerateTrainingResponse(
            success=True,
            message="No significant patterns detected. Keep practising your assessments!",
            module_count=0,
        )

    # 4. Flatten exercise_sets → one plan dict per disorder
    exercise_sets = ctm_response.get("exercise_sets", [])
    plans = []
    for ex_set in exercise_sets:
        diagnosis = ex_set.get("diagnosis", {})
        error_name = diagnosis.get("error_name", "unknown")
        # Bug 3 fix: use only the error name slug for module_id (no positional index).
        # Previously `train_{slug}_{idx+1:03d}` changed whenever a new comorbidity
        # shifted the triage sort order, orphaning old ZIP caches on the device.
        # There are exactly 9 unique error types so slug collisions are impossible.
        slug = error_name.lower().replace(" ", "_")
        module_id = f"train_{slug}"

        plan = {
            "module_id":      module_id,
            "error_name":     error_name,
            "major_type":     diagnosis.get("major_type", ""),
            "severity":       diagnosis.get("severity", 0.0),
            "active_phonemes": diagnosis.get("active_phonemes", []),
            "language":       req.language,
            "exercise_params": ex_set.get("exercise_params", {}),
            "levels":         ex_set.get("levels", []),
            "status":         "pending",
        }
        plans.append(plan)

    # 5. Store in Firestore (overwrites previous plans)
    stored = await FirestoreService.store_training_plans(
        user_id=req.user_id,
        plans=plans,
    )
    if not stored:
        raise HTTPException(
            status_code=500,
            detail="Failed to save training plans.",
        )

    logger.info(
        f"✅ Training plans generated: {len(plans)} modules for {req.user_id}"
    )
    return GenerateTrainingResponse(
        success=True,
        message=f"{len(plans)} personalised training module(s) ready to download.",
        module_count=len(plans),
    )


@router.get("/training", response_model=TrainingModulesResponse)
async def get_training_modules(
    user_id: str = Query(...),
    language: Optional[str] = Query(None, description="Filter: 'english' or 'urdu'"),
) -> TrainingModulesResponse:
    """
    Returns the list of training modules assigned to the user.
    No bundle data is returned here — use GET /v1/training/{id}/bundle.
    """
    logger.info(f"📋 Fetching training modules for {user_id} (language: {language or 'all'})")
    raw = await FirestoreService.get_user_training_modules(user_id, language=language)
    modules = [
        TrainingModule(
            id=m["id"],
            error_name=m["error_name"],
            major_type=m["major_type"],
            severity=m["severity"],
            language=m["language"],
            level_count=m["level_count"],
            status=m["status"],
        )
        for m in raw
    ]
    return TrainingModulesResponse(modules=modules)


@router.get("/training/{module_id}/bundle")
async def download_training_bundle(
    module_id: str,
    user_id: str = Query(...),
):
    """
    Returns a ZIP bundle for one training module.

    ZIP structure:
        data.json              — plan metadata + levels + assistant_lines
        audio/item/*.wav       — exercise item audio (TTS-synthesised on demand)
        audio/assistant/*.wav  — static training coach lines (from HF TrainingTTS)

    Frontend downloads once, extracts locally, and resolves all audio paths
    from the relative paths in data.json.

    Args:
        module_id: e.g. "train_velar_fronting_001"
        user_id:   User whose plan to use
    """
    logger.info(f"📥 Training bundle request: {module_id} for user {user_id}")

    plan = await FirestoreService.get_training_plan(user_id, module_id)
    if not plan:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Training plan '{module_id}' not found for user '{user_id}'. "
                "Call POST /training/generate first."
            ),
        )

    language = plan.get("language", "english")

    import asyncio
    try:
        zip_bytes = await asyncio.wait_for(build_training_bundle(plan, language), timeout=180.0)
    except asyncio.TimeoutError:
        logger.error(f"❌ Training bundle assembly timed out for {module_id}")
        raise HTTPException(
            status_code=504,
            detail="Bundle assembly timed out. The module might be too large or TTS is overloaded.",
        )
    except Exception as e:
        logger.error(f"❌ Training bundle assembly failed for {module_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Bundle assembly failed: {e}",
        )

    if not zip_bytes:
        raise HTTPException(
            status_code=500,
            detail="Training bundle is empty — TTS or audio assets may be unavailable.",
        )

    logger.info(f"✅ Serving training bundle: {module_id} ({len(zip_bytes):,} bytes)")
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{module_id}.zip"'},
    )


# ==========================================
# 8. Techniques Module (CTkM proxy)
# ==========================================

@router.get('/techniques')
async def list_techniques(
    user_id: str = Query(...),
    disorder: Optional[str] = Query(None),
    language: str = Query(default='english'),
) -> Dict[str, Any]:
    '''
    Returns all techniques for a user, enriched with their personal progress.
    Proxies to CTkM GET /api/techniques.
    '''
    logger.info(f'📚 Techniques manifest: user={user_id} disorder={disorder} lang={language}')
    params = {'user_id': user_id, 'language': language}
    if disorder:
        params['disorder'] = disorder
    async with httpx.AsyncClient(timeout=_CTMK_TIMEOUT) as c:
        r = await c.get(f'{_CTMK}/api/techniques', params=params)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get('/techniques/{technique_id}/exercise')
async def get_technique_exercise(
    technique_id: str,
    user_id: str = Query(...),
    language: str = Query(default='english'),
    difficulty: int = Query(default=1),
) -> Dict[str, Any]:
    '''
    Returns a ready-to-play exercise session for a technique.
    Includes 5 sentences with pre-generated TTS audio (base64) and instructions.
    Proxies to CTkM GET /api/techniques/{technique_id}/exercise.
    '''
    logger.info(f'🎯 Exercise session: {technique_id} user={user_id} lang={language} diff={difficulty}')
    async with httpx.AsyncClient(timeout=_CTMK_TIMEOUT) as c:
        r = await c.get(
            f'{_CTMK}/api/techniques/{technique_id}/exercise',
            params={'user_id': user_id, 'language': language, 'difficulty': str(difficulty)}
        )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get('/techniques/{technique_id}/tts-steps')
async def get_technique_step_audio(
    technique_id: str,
    language: str = Query(default='english'),
) -> List[Dict[str, Any]]:
    '''
    Returns TTS audio (base64) for each step of a technique.
    Called lazily when user opens the technique detail/info screen.
    Proxies to CTkM GET /api/techniques/{technique_id}/tts-steps.
    '''
    logger.info(f'🔊 TTS steps: {technique_id} lang={language}')
    async with httpx.AsyncClient(timeout=_CTMK_TIMEOUT) as c:
        r = await c.get(
            f'{_CTMK}/api/techniques/{technique_id}/tts-steps',
            params={'language': language}
        )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.post('/techniques/score')
async def score_technique_recording(
    audio: UploadFile = File(...),
    technique_id: str = Form(...),
    sentence_id: int = Form(...),
    sentence_text: str = Form(...),
    language: str = Form(default='english'),
    scoring_mode: str = Form(...),
    scoring_config_json: str = Form(default='{}'),
    tap_times_json: str = Form(default='[]'),
) -> Dict[str, Any]:
    '''
    Submits a user's technique recording for scoring.
    Proxies the audio + metadata to CTkM POST /api/techniques/score.
    CTkM routes internally to the appropriate scorer (CAM / Praat / Silero VAD etc).
    Returns ScoreResult with score (0-100), grade, feedback text, and TTS audio (base64).
    '''
    logger.info(f'🎤 Technique score: {technique_id} mode={scoring_mode} lang={language}')
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail='Audio file is empty')
    async with httpx.AsyncClient(timeout=_CTMK_TIMEOUT) as c:
        r = await c.post(
            f'{_CTMK}/api/techniques/score',
            data={
                'technique_id':       technique_id,
                'sentence_id':        str(sentence_id),
                'sentence_text':      sentence_text,
                'language':           language,
                'scoring_mode':       scoring_mode,
                'scoring_config_json': scoring_config_json,
                'tap_times_json':     tap_times_json,
            },
            files={'audio': ('audio.wav', audio_bytes, 'audio/wav')}
        )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.post('/techniques/progress')
async def log_technique_progress(req: Dict[str, Any]) -> Dict[str, Any]:
    '''
    Logs a completed technique practice session.
    Called after every session (scored or passive).
    Proxies to CTkM POST /api/techniques/progress.
    Returns sessions_completed count and lifetime_avg_score.
    '''
    user_id = req.get('user_id', 'unknown')
    technique_id = req.get('technique_id', 'unknown')
    logger.info(f'📈 Progress log: {technique_id} user={user_id}')
    async with httpx.AsyncClient(timeout=_CTMK_TIMEOUT) as c:
        r = await c.post(f'{_CTMK}/api/techniques/progress', json=req)
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get('/techniques/{technique_id}/history')
async def get_technique_history(
    technique_id: str,
    user_id: str = Query(...),
    limit: int = Query(default=20),
) -> List[Dict[str, Any]]:
    '''
    Returns past practice sessions for one technique for a user.
    Used by the Progress History screen in Flutter.
    Proxies to CTkM GET /api/techniques/{technique_id}/history.
    '''
    logger.info(f' History: {technique_id} user={user_id}')
    async with httpx.AsyncClient(timeout=_CTMK_TIMEOUT) as c:
        r = await c.get(
            f'{_CTMK}/api/techniques/{technique_id}/history',
            params={'user_id': user_id, 'limit': str(limit)}
        )
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()

