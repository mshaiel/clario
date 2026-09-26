from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


# ─── Technique Manifest ──────────────────────────────────────────────────────

class TechniqueItem(BaseModel):
    id: str
    name: str
    disorder: str
    category: str
    tier: int
    interaction_type: str
    youtube_id: Optional[str] = None
    diagram_url: Optional[str] = None  # /api/diagram/{filename}
    steps: List[str]
    has_exercise: bool
    sessions_completed: int = 0
    last_score: Optional[float] = None
    last_practiced: Optional[str] = None


class ManifestResponse(BaseModel):
    techniques: List[TechniqueItem]
    total: int


# ─── Exercise Session ─────────────────────────────────────────────────────────

class ExerciseItem(BaseModel):
    sentence_id: int
    sentence: str
    cam_sentence_id: Optional[str] = None
    tts_audio_b64: str          # base64 WAV of TTS reading the sentence
    instruction: str            # e.g. 'Use Easy Onset on every word'
    instruction_audio_b64: str  # TTS of the instruction text
    phoneme_focus: Optional[str] = None


class ExerciseSessionResponse(BaseModel):
    technique_id: str
    interaction_type: str
    scoring_mode: str
    scoring_config: Dict[str, Any]
    items: List[ExerciseItem]
    difficulty: int


# ─── Score Result ─────────────────────────────────────────────────────────────

class ScoreResult(BaseModel):
    success: bool
    technique_id: str
    sentence_id: int
    score: float                # 0.0 – 100.0
    grade: str                  # 'excellent'/'good'/'needs_work'/'try_again'
    feedback_en: str
    feedback_ur: str
    feedback_audio_b64: str     # TTS of feedback_en
    details: Dict[str, Any]     # Scorer-specific breakdown data


# ─── Progress Log ─────────────────────────────────────────────────────────────

class ProgressLogRequest(BaseModel):
    user_id: str
    technique_id: str
    score: Optional[float] = None
    duration_sec: int = 0
    session_data: Dict[str, Any] = {}


class ProgressLogResponse(BaseModel):
    success: bool
    sessions_completed: int
    lifetime_avg_score: Optional[float] = None
