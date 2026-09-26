"""
API Schemas for Unified Assistant Backend (UAB)
Strict Pydantic models for the stateless HTTP architecture.
"""
from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Annotated, List, Optional, Dict, Any, Union, Literal
from enum import Enum


# ==========================================
# 1. Questionnaire & Profile Management
# ==========================================

class QuestionnaireSelection(BaseModel):
    """Individual clinical concern selection from onboarding"""
    primary_concern: str  # "phonology", "fluency", etc.
    subtype: str  # "velar_fronting", "blocks", "repetition", etc.
    focus_phonemes: List[str] = Field(default_factory=list)
    danger_words: List[str] = Field(default_factory=list)


class QuestionnaireRequest(BaseModel):
    """Onboarding questionnaire submission"""
    user_id: str
    full_name: str = ""           # User's display name
    language: str = "english"
    target_persona: str  # "child", "adult", etc.
    selections: List[QuestionnaireSelection]


class QuestionnaireResponse(BaseModel):
    """Response to questionnaire submission"""
    success: bool
    message: str = "Profile created. Assessments assigned."


# ==========================================
# 2. Assessment & Practice Manifests (OTA)
# ==========================================

class Assessment(BaseModel):
    """Individual assessment module available to user"""
    id: str          # e.g., "assess_velar_fronting_v1"
    test_type: str   # e.g., "velar_fronting", "comprehensive", "blocks"
    title: str
    description: str
    language: str    # "english" or "urdu"
    version: str     # e.g., "1.0.0"
    # Bundle downloaded via: GET /v1/assessments/{id}/bundle?user_id=...


class AssessmentsResponse(BaseModel):
    """Response for GET /v1/assessments"""
    assessments: List[Assessment]


class PracticeModule(BaseModel):
    """Individual practice module available to user"""
    id: str  # e.g., "prac_velar_v2"
    test_type: str
    title: str
    description: str
    download_url: str  # OTA .zip file URL
    version: str


class PracticeResponse(BaseModel):
    """Response for GET /v1/practice"""
    practice_modules: List[PracticeModule]


# ==========================================
# 3. Polymorphic Error Types
# ==========================================

class FlaggedWord(BaseModel):
    """Base error class — shared fields across all error types"""
    word: str
    index_in_sentence: int
    error_category: str  # "phonology" or "fluency"
    error_type: str
    # Clinical process name (e.g. "stopping", "velar_fronting", "gliding").
    # Frontend must echo this field back in ValidatedError.process when calling
    # POST /assistant/validate-session so the tensor can be updated correctly.
    process: Optional[str] = None
    assistant_text: Optional[str] = None
    assistant_audio_url: Optional[str] = None


class PhonologyError(FlaggedWord):
    """Phonology errors: Substitution, Omission, Addition"""
    error_category: Literal["phonology"]
    error_type: Literal["substitution", "omission", "addition"]
    expected_phoneme: str
    heard_phoneme: str


class ProlongationError(FlaggedWord):
    """Fluency error: Sound prolongation"""
    error_category: Literal["fluency"]
    error_type: Literal["prolongation"]
    phoneme_prolonged: str
    duration_ms: int


class StutterError(FlaggedWord):
    """Fluency error: Stutter/Repetition"""
    error_category: Literal["fluency"]
    error_type: Literal["stutter"]
    phonemes_stuttered: List[str]
    repetition_count: int


class BlockError(FlaggedWord):
    """Fluency error: Block (airflow stoppage or tense pause)"""
    error_category: Literal["fluency"]
    error_type: Literal["block"]
    block_duration_ms: int
    preceding_phoneme: Optional[str] = None


# Discriminated union keyed on error_type.
# Since all error_type Literal values across the four subclasses are mutually
# exclusive, Pydantic v2 can use error_type as an unambiguous discriminator.
FlaggedWordUnion = Annotated[
    Union[PhonologyError, ProlongationError, StutterError, BlockError],
    Field(discriminator="error_type"),
]


# ==========================================
# 4. Audio Analysis
# ==========================================

class WordStatus(str, Enum):
    HEARD       = "heard"
    SKIPPED     = "skipped"
    SUBSTITUTED = "substituted"


class ErrorPosition(str, Enum):
    INITIAL = "initial"
    MEDIAL = "medial"
    FINAL = "final"


class WordResult(BaseModel):
    word:     str
    status:   WordStatus
    heard_as: Optional[str] = None  # populated only for substituted


class AnalyzeAudioResponse(BaseModel):
    """Response from audio analysis endpoint"""
    sentence_id:       str
    sentence_accuracy: float              # 0.0–100.0 (CAM returns float, e.g. 66.67)
    transcript:        str = ""           # raw Whisper transcript
    word_results:      List[WordResult] = Field(default_factory=list)
    flagged_words:     List[FlaggedWordUnion] = Field(default_factory=list)
    # Per-test SODA results keyed by test_type, e.g. results["velar_fronting"].
    # Each value contains detected_count, events[], raw_soda[], alignment_confidence.
    # FastAPI would strip this if absent from the model — it MUST be declared here
    # so the CAM's clinical event data reaches the frontend.
    results:           Optional[Dict[str, Any]] = Field(default=None)


# ==========================================
# 5. Batch Validation & Active Learning
# ==========================================

class ValidatedError(BaseModel):
    """
    Single error after user validation (false positives removed).

    The `process` field carries the clinical process name as identified by the
    Analysis Module (e.g. "stopping", "velar_fronting", "gliding").  This allows
    the tensor update to set the correct column (Stopping=2, Velar Fronting=1, …)
    instead of always falling back to the generic Substitution column (0).
    """
    sentence_id: str
    word: str
    index_in_sentence: int
    position: ErrorPosition
    error_category: str  # "phonology" or "fluency"
    error_type: str      # schema-level type: "substitution", "omission", "block", …

    # Clinical process name (e.g. "stopping", "velar_fronting").
    # Populated for phonology errors from the Analysis Module sub_test_type.
    process: Optional[str] = None

    # Optional fields depending on error type
    expected_phoneme: Optional[str] = None
    heard_phoneme: Optional[str] = None
    phoneme_prolonged: Optional[str] = None
    duration_ms: Optional[int] = None
    phonemes_stuttered: Optional[List[str]] = None
    repetition_count: Optional[int] = None
    block_duration_ms: Optional[int] = None
    preceding_phoneme: Optional[str] = None


class ValidateSessionRequest(BaseModel):
    """Batch submission of validated errors after session completion"""
    user_id: str  # Required — must come from auth header in production
    test_id: str  # e.g., "assess_comp_v1"
    test_type: str  # e.g., "comprehensive"
    overall_session_accuracy: int
    validated_errors: List[ValidatedError]
    correct_phonemes: List[str] = Field(default_factory=list)


class ValidateSessionResponse(BaseModel):
    """Response from batch validation endpoint"""
    success: bool
    message: str
    tensor_updated: bool  # Whether user's ML tensor was updated


# ==========================================
# 6. Dynamic TTS Generation
# ==========================================

class TTSGenerateRequest(BaseModel):
    """Request to generate TTS audio dynamically"""
    text: str
    language: str = "english"  # "english" or "urdu"
    gender: str = "m"  # "m" or "f" — hint for edge-tts fallback


class TTSGenerateResponse(BaseModel):
    """Response from TTS generation endpoint"""
    success: bool
    message: str
    audio_url: Optional[str] = None
    duration_ms: Optional[int] = None  # Duration in whole milliseconds


# ==========================================
# 7. Exercise Strategy / Training Modules
# ==========================================

class UserStatsPayload(BaseModel):
    severity: float
    fatigue: float
    age: float
    delta: float


class GenerateTrainingRequest(BaseModel):
    """Request to generate a personalized exercise strategy via CTM."""
    user_id: str
    language: str = "english"           # "english" or "urdu"
    force_easier: bool = False           # Pass True after repeated failures
    user_stats: UserStatsPayload         # Explicit stat overrides from frontend


class GenerateTrainingResponse(BaseModel):
    """Response from POST /training/generate"""
    success: bool
    message: str
    module_count: int = 0               # How many disorder modules were created


class TrainingModule(BaseModel):
    """Summary of one training module (one disorder, N levels)."""
    id: str                             # e.g. "train_velar_fronting"
    error_name: str                     # e.g. "Velar Fronting"
    major_type: str                     # "Artic", "Fluency", or "Motor"
    severity: float                     # 0.0–1.0
    language: str                       # "english" or "urdu"
    level_count: int                    # number of exercise levels
    status: str                         # "pending" | "in_progress" | "completed"
    # Bundle downloaded via: GET /v1/training/{id}/bundle?user_id=...


class TrainingModulesResponse(BaseModel):
    """Response for GET /v1/training"""
    modules: List[TrainingModule]

