import asyncio
import json
import os
import re
import sqlite3
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from api.schemas import (
    ExerciseSessionResponse,
    ExerciseItem,
    ManifestResponse,
    ProgressLogRequest,
    ProgressLogResponse,
    ScoreResult,
    TechniqueItem,
)
from core.scoring.cam_proxy import score_with_cam
from core.scoring.phonation_analyzer import analyze_phonation
from core.scoring.rate_analyzer import analyze_rate
from core.scoring.repair_detector import RepairDetector
from core.scoring.rhythm_analyzer import analyze_rhythm
from core.scoring.voice_quality import analyze_voice_quality
from core.sentence_bank import SentenceBank
from core.technique_bank import TechniqueBank
from services.progress_service import ProgressService
from services.tts_service import TTSService

router = APIRouter()

DIAGRAMS_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'diagrams')
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'techniques.db')


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _scoring_mode(tech: dict) -> str:
    mapping = {
        'cam_scored': 'cam',
        'rate': 'rate',
        'repair': 'repair',
        'phonation': 'phonation',
        'rhythm': 'rhythm',
        'voice_quality': 'voice_quality',
        'passive': 'none',
        'daf': 'none',
        'client_game': 'none',
    }
    return mapping.get(tech['interaction_type'], 'cam')


def _grade(score: float) -> str:
    if score >= 90:
        return 'excellent'
    if score >= 75:
        return 'good'
    if score >= 50:
        return 'needs_work'
    return 'try_again'


def _build_instruction(tech: dict, language: str) -> str:
    """Generate a short spoken instruction for the exercise screen."""
    mode = _scoring_mode(tech)
    instructions = {
        'cam':          'Record each sentence using this technique. We will score your fluency.',
        'rate':         'Speak each sentence at the target pace. We will measure your syllable rate.',
        'repair':       'Allow a block to occur, then pause and repair. We detect the pause and repair.',
        'phonation':    'Flow from word to word with no gaps. We measure silence between words.',
        'rhythm':       'Tap the screen once per beat while you speak. We score your rhythm.',
        'voice_quality':'Start each word in a whisper, then transition to full voice. We measure the energy ramp.',
        'none':         'Follow the steps shown. Mark the session complete when you are done.',
    }
    return instructions.get(mode, instructions['cam'])


def _build_feedback(
    scoring_mode: str,
    result: dict,
    grade: str,
    language: str,
) -> tuple[str, str]:
    """Return (feedback_en, feedback_ur) based on scorer result."""
    fk = result.get('feedback_key', '')

    # Rate feedback
    if scoring_mode == 'rate':
        actual = result.get('actual_spm', 0)
        target = result.get('target_spm', 220)
        if fk == 'good':
            en = 'Great pace! Your syllable rate was right on target. Keep practising to maintain this.'
            ur = 'Shabaash! Aapki rate bilkul target ke mutabiq thi.'
        elif fk == 'too_fast':
            en = f'A bit fast — your rate was {actual} SPM vs target {target} SPM. Try stretching each vowel more.'
            ur = f'Thodi tez — aapki rate {actual} SPM thi, target {target} SPM hai. Har vowel ko zyada kheinchein.'
        else:
            en = f'A little slower than ideal — {actual} SPM vs target {target} SPM. Try to match the target range.'
            ur = f'Thoda slow — {actual} SPM vs target {target} SPM. Target range match karne ki koshish karein.'

    # Phonation / gap feedback
    elif scoring_mode == 'phonation':
        broken = result.get('broken_gaps', 0)
        if fk == 'good':
            en = 'Excellent! Your speech was smooth and continuous across all word boundaries.'
            ur = 'Zabardast! Aapki awaz har lafz ke darmiyan bilkul smooth thi.'
        else:
            en = f'{broken} word boundaries had gaps longer than the target. Focus on keeping airflow active between words.'
            ur = f'{broken} jagah par gaps target se zyada the. Lafzon ke darmiyan hawa jaari rakhen.'

    # Repair feedback
    elif scoring_mode == 'repair':
        if fk == 'repair_successful':
            en = 'Well done! We detected a pause after the disfluency followed by a fluent repair. That is exactly cancellation.'
            ur = 'Bahut acha! Block ke baad pause aur phir fluent repair mili — yahi cancellation hai.'
        elif fk == 'pause_found_no_repair':
            en = 'We found the pause — good. But the target word was not clearly detected after the pause. Try saying the word again more clearly after pausing.'
            ur = 'Pause mila — acha. Lekin pause ke baad lafz clearly nahi aaya. Pause ke baad zyada clearly bolein.'
        else:
            en = 'We did not detect a pause after the disfluency. Cancellation requires a clear 0.5–1 second pause before the repair attempt.'
            ur = 'Block ke baad pause nahi mila. Cancellation ke liye 0.5-1 second ka clear pause zaruri hai.'

    # Rhythm feedback
    elif scoring_mode == 'rhythm':
        if fk == 'good':
            en = 'Very rhythmic! Your tapping was consistent and matched the target tempo closely.'
            ur = 'Bahut rhythmic! Aapka tapping consistent tha aur target tempo se match kiya.'
        elif fk == 'too_irregular':
            en = 'Your rhythm had some irregularity. Try to keep the time between taps as even as possible.'
            ur = 'Rhythm mein kuch irregularity thi. Taps ke darmiyan time baraabar rakhen.'
        else:
            en = 'Your tempo did not quite match the target BPM. Try to synchronise more closely with the beat shown on screen.'
            ur = 'Tempo target BPM se match nahi kiya. Screen par dikhne wali beat ke saath synchronise karein.'

    # Voice quality feedback
    elif scoring_mode == 'voice_quality':
        if fk == 'good':
            en = 'Great transition! Your voice smoothly rose from whisper to full voicing.'
            ur = 'Shabaash! Aapki awaz whisper se full voice mein smoothly aayi.'
        else:
            en = 'The voice onset was too abrupt. Start in a true whisper and gradually increase volume across the word.'
            ur = 'Awaz zyada abruptly shuru hui. Pehle sachchi whisper karein aur phir dhire dhire awaz barahaein.'

    # CAM / default feedback
    else:
        if grade == 'excellent':
            en = 'Excellent! Your speech was very accurate. Outstanding work.'
            ur = 'Zabardast! Aapki speech bohat accurate thi.'
        elif grade == 'good':
            en = 'Good work! Your accuracy was above the target. Keep practising to reach excellent.'
            ur = 'Acha kaam! Accuracy target se upar thi.'
        elif grade == 'needs_work':
            en = 'You are making progress. Focus on the technique steps and try again.'
            ur = 'Taraqqi ho rahi hai. Technique steps par focus karein aur dobara try karein.'
        else:
            en = 'Keep trying — this technique takes practice. Review the steps and record again.'
            ur = 'Koshish jari rakhen — yeh technique practice maangti hai. Steps dekhein aur dobara record karein.'

    return en, ur


# ─── 1. GET /techniques ────────────────────────────────────────────────────────

@router.get('/techniques', response_model=ManifestResponse)
async def get_techniques(
    user_id: str,
    disorder: Optional[str] = None,
    language: str = 'english',
):
    """Returns all techniques enriched with the user's personal progress data."""
    all_techs = TechniqueBank.get_all(disorder=disorder)
    progress_map = await ProgressService.get_user_summary(user_id)

    items = []
    for t in all_techs:
        prog = progress_map.get(t['id'], {})
        steps = json.loads(t['steps_ur'] if language == 'urdu' else t['steps_en'])
        diagram_url = f'/api/diagram/{t["diagram_file"]}' if t.get('diagram_file') else None
        youtube_id = t.get('youtube_id_ur' if language == 'urdu' else 'youtube_id_en')

        items.append(TechniqueItem(
            id=t['id'],
            name=t['name_ur'] if language == 'urdu' else t['name_en'],
            disorder=t['disorder'],
            category=t['category'],
            tier=t['tier'],
            interaction_type=t['interaction_type'],
            youtube_id=youtube_id,
            diagram_url=diagram_url,
            steps=steps,
            has_exercise=t['tier'] >= 2,
            sessions_completed=prog.get('count', 0),
            last_score=prog.get('last_score'),
            last_practiced=prog.get('last_date'),
        ))

    return ManifestResponse(techniques=items, total=len(items))


# ─── 2. GET /techniques/{technique_id}/exercise ────────────────────────────────

@router.get('/techniques/{technique_id}/exercise', response_model=ExerciseSessionResponse)
async def get_exercise(
    technique_id: str,
    user_id: str,
    language: str = 'english',
    difficulty: int = 1,
):
    """
    Fetch sentences, generate TTS demo audio in parallel, and return
    a full exercise session payload ready for the Flutter app.
    """
    tech = TechniqueBank.get_by_id(technique_id)
    if not tech:
        raise HTTPException(status_code=404, detail=f'Technique {technique_id} not found')

    sentences = SentenceBank.get(technique_id, language=language, difficulty=difficulty, limit=5)
    if not sentences:
        raise HTTPException(status_code=404, detail='No sentences found for this configuration')

    instruction_text = _build_instruction(tech, language)
    tts_language = 'urdu' if language == 'urdu' else 'english'

    # Parallel TTS: all sentences + instruction in one gather
    tts_tasks = [TTSService.synthesize(s['sentence'], tts_language) for s in sentences]
    tts_tasks.append(TTSService.synthesize(instruction_text, tts_language))
    audio_results = await asyncio.gather(*tts_tasks)
    instruction_audio = audio_results[-1]

    items = [
        ExerciseItem(
            sentence_id=s['id'],
            sentence=s['sentence'],
            cam_sentence_id=s.get('cam_sentence_id'),
            tts_audio_b64=audio_results[i],
            instruction=instruction_text,
            instruction_audio_b64=instruction_audio,
            phoneme_focus=s.get('phoneme_focus'),
        )
        for i, s in enumerate(sentences)
    ]

    scoring_config = json.loads(tech.get('scoring_config') or '{}')

    return ExerciseSessionResponse(
        technique_id=technique_id,
        interaction_type=tech['interaction_type'],
        scoring_mode=_scoring_mode(tech),
        scoring_config=scoring_config,
        items=items,
        difficulty=difficulty,
    )


# ─── 3. POST /techniques/score ────────────────────────────────────────────────

@router.post('/techniques/score', response_model=ScoreResult)
async def score_recording(
    audio: Optional[UploadFile] = File(None),
    technique_id: str = Form(...),
    sentence_id: int = Form(...),
    sentence_text: str = Form(...),
    cam_sentence_id: Optional[str] = Form(default=None),
    language: str = Form(default='english'),
    scoring_mode: str = Form(...),
    scoring_config_json: str = Form(default='{}'),
    tap_times_json: str = Form(default='[]'),
):
    """
    Receive multipart audio + metadata, route to the correct scorer,
    generate feedback TTS, and return a ScoreResult.
    """
    audio_bytes = await audio.read() if audio else b''
    config = json.loads(scoring_config_json)
    tap_times = json.loads(tap_times_json)
    tech = TechniqueBank.get_by_id(technique_id)

    result: dict = {}

    if scoring_mode != 'rhythm' and not audio_bytes:
        raise HTTPException(status_code=400, detail='Audio file is required for this scoring mode')

    try:
        if scoring_mode == 'cam':
            cam_test_type = config.get('cam_test_type', tech.get('cam_test_type', 'blocks') if tech else 'blocks')
            result = await score_with_cam(audio_bytes, sentence_text, cam_test_type, language, cam_sentence_id)
        elif scoring_mode == 'rate':
            result = analyze_rate(audio_bytes, config)
        elif scoring_mode == 'phonation':
            result = analyze_phonation(audio_bytes, config)
        elif scoring_mode == 'repair':
            result = await RepairDetector.analyze(audio_bytes, sentence_text, config)
        elif scoring_mode == 'rhythm':
            result = analyze_rhythm(tap_times, config)
        elif scoring_mode == 'voice_quality':
            result = analyze_voice_quality(audio_bytes, config)
        else:
            raise HTTPException(status_code=400, detail=f'Unknown scoring_mode: {scoring_mode}')
    except HTTPException:
        raise  # re-raise 400s untouched
    except Exception as exc:
        import logging as _log
        _log.getLogger('router').error(f'Scorer "{scoring_mode}" raised: {exc}', exc_info=True)
        raise HTTPException(status_code=500, detail=f'Scoring engine error ({scoring_mode}): {exc}')

    score = float(result.get('score', 0.0))
    grade = _grade(score)
    fb_en, fb_ur = _build_feedback(scoring_mode, result, grade, language)
    fb_audio = await TTSService.synthesize(fb_en, 'english')

    return ScoreResult(
        success=result.get('success', True),
        technique_id=technique_id,
        sentence_id=sentence_id,
        score=round(score, 2),
        grade=grade,
        feedback_en=fb_en,
        feedback_ur=fb_ur,
        feedback_audio_b64=fb_audio,
        details=result,
    )


# ─── 4. POST /techniques/progress ─────────────────────────────────────────────

@router.post('/techniques/progress', response_model=ProgressLogResponse)
async def log_progress(req: ProgressLogRequest):
    """Log a completed technique session to SQLite + Firestore."""
    result = await ProgressService.log_session(
        user_id=req.user_id,
        technique_id=req.technique_id,
        score=req.score,
        duration_sec=req.duration_sec,
        session_data=req.session_data,
    )
    return ProgressLogResponse(**result)


# ─── 5. GET /diagram/{filename} ───────────────────────────────────────────────

@router.get('/diagram/{filename}')
async def serve_diagram(filename: str):
    """Serve SVG clinical diagrams. Strict filename sanitisation applied."""
    if not re.match(r'^[\w\-\.]+$', filename):
        raise HTTPException(status_code=403, detail='Invalid filename')
    path = os.path.join(DIAGRAMS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail='Diagram not found')
    return FileResponse(path, media_type='image/svg+xml')


# ─── 6. GET /techniques/{technique_id}/tts-steps ─────────────────────────────

@router.get('/techniques/{technique_id}/tts-steps')
async def get_step_audios(technique_id: str, language: str = 'english'):
    """
    Return TTS audio (base64) for every step of a technique.
    Called lazily when user taps the speaker icon — not on screen load.
    """
    tech = TechniqueBank.get_by_id(technique_id)
    if not tech:
        raise HTTPException(status_code=404, detail='Technique not found')

    steps = json.loads(tech['steps_ur'] if language == 'urdu' else tech['steps_en'])
    tts_lang = 'urdu' if language == 'urdu' else 'english'
    audios = await asyncio.gather(*[TTSService.synthesize(s, tts_lang) for s in steps])

    return [
        {'step_index': i, 'text': steps[i], 'audio_b64': a}
        for i, a in enumerate(audios)
    ]


# ─── 7. GET /techniques/{technique_id}/history ────────────────────────────────

@router.get('/techniques/{technique_id}/history')
async def get_history(technique_id: str, user_id: str, limit: int = 20):
    """
    Returns past practice sessions for one technique, sorted by date descending.
    Used by the Progress History screen in Flutter.
    Also added to CTkM per ADDENDUM Section 3.2 Step 4.
    """
    return await ProgressService.get_history(user_id, technique_id, limit)
