"""
API Schema Definitions
----------------------
Compatible schemas for stateless analysis API.
"""

from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum


class Language(str, Enum):
    ENGLISH = "english"
    URDU = "urdu"


class TestType(str, Enum):
    COMPREHENSIVE = "comprehensive"
    PHONOLOGY = "phonology"
    FLUENCY = "fluency"
    BLOCKS = "blocks"
    PROLONGATION = "prolongation"
    REPETITION = "repetition"
    VELAR_FRONTING = "velar_fronting"
    STOPPING = "stopping"
    GLIDING = "gliding"
    CLUSTER_REDUCTION = "cluster_reduction"
    EPENTHESIS = "epenthesis"


# ─── Response Schemas ─────────────────────────────────────────────────────────

class WordStatus(str, Enum):
    HEARD       = "heard"
    SKIPPED     = "skipped"
    SUBSTITUTED = "substituted"


class WordResult(BaseModel):
    word:     str
    status:   WordStatus
    heard_as: Optional[str] = None  # populated only for substituted


class AnalysisResponse(BaseModel):
    success: bool
    test_type: TestType
    sentence_id: str
    text: str
    language: str = "english"
    transcript: str = ""
    accuracy_score: float = 0.0
    word_results: List[WordResult] = Field(default_factory=list)
    results: Dict[str, Any] = Field(default_factory=dict)
    errors: Optional[List[str]] = None


class ErrorResponse(BaseModel):
    success: bool = Field(default=False)
    error: str
    error_code: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class PacingWord(BaseModel):
    word: str
    start: float
    end: float


class PacingMetrics(BaseModel):
    target_wpm: float
    actual_active_wpm: float
    rhythm_variance: float
    is_pace_good: bool
    is_rhythm_consistent: bool


class PacingResponse(BaseModel):
    success: bool
    metrics: PacingMetrics
    feedback: str
    words: List[PacingWord]


# ─── Utility Functions ────────────────────────────────────────────────────────

ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".webm", ".3gp"}


def validate_audio_file_extension(filename: str) -> bool:
    ext = "." + filename.lower().split(".")[-1] if "." in filename else ""
    return ext in ALLOWED_AUDIO_EXTENSIONS


def create_error_response(message: str, error_code: Optional[str] = None) -> Dict:
    return ErrorResponse(
        error=message,
        error_code=error_code,
    ).model_dump()
