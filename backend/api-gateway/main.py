import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import our utilities and routers
from utils.logger import get_logger
from api.router_http import router as http_router

# Import services for startup initialization
from services.tts_service import CoquiTTSService
from services.training_service import TrainingService
from core.recommender import recommender as _recommender
try:
    from services.audio_asset_service import AudioAssetService
    AUDIO_ASSETS_AVAILABLE = True
except ImportError:
    AUDIO_ASSETS_AVAILABLE = False

try:
    from services.training_asset_service import TrainingAssetService
    TRAINING_ASSETS_AVAILABLE = True
except ImportError:
    TRAINING_ASSETS_AVAILABLE = False

# Initialize the standardized logger
logger = get_logger("ClarioUA")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup and shutdown lifecycle."""
    logger.info("Starting Clario Unified Assistant (UAB) v2.0...")

    # Run blocking Coqui model load in a thread executor so the event loop
    # is not blocked during the potentially long model-loading operation.
    tts_ok = await asyncio.to_thread(CoquiTTSService.initialize)
    if tts_ok:
        logger.info("Coqui XTTS v2 ready (premium TTS for sentence banks and coaching)")
    else:
        logger.warning("Coqui XTTS v2 initialization failed - edge-tts fallback active")

    logger.info("HTTP API loaded (stateless REST architecture)")
    logger.info("Dynamic TTS endpoint ready for coaching audio")
    logger.info(f"Training backend configured: {TrainingService.backend_url()}")

    # Report recommender status (loaded at import time via module-level singleton)
    total_sentences = sum(len(v) for v in _recommender.sentence_banks.values())
    if total_sentences:
        logger.info(
            f"Recommender ready — {total_sentences} sentences across "
            f"{len(_recommender.sentence_banks)} banks"
        )
    else:
        logger.warning("Recommender initialized but no sentence banks loaded — check Firestore")

    # Initialize audio asset service for voice variations
    if AUDIO_ASSETS_AVAILABLE:
        if AudioAssetService.load_manifest():
            logger.info("Audio asset service initialized (voice variations ready)")
        else:
            logger.warning("Audio assets could not be loaded (voice variations disabled)")
    else:
        logger.warning("AudioAssetService not available")

    # Initialize training asset service for exercise coaching audio
    if TRAINING_ASSETS_AVAILABLE:
        if TrainingAssetService.load_manifest():
            logger.info("Training asset service initialized (exercise coach audio ready)")
        else:
            logger.warning("Training assets could not be loaded (TrainingTTS disabled)")
    else:
        logger.warning("TrainingAssetService not available")

    yield  # Application runs here


app = FastAPI(
    title="Clario Unified Assistant (UAB)",
    version="2.0.0",
    description=(
        "Stateless REST API for thin-client architecture. "
        "Downloads content locally, analyzes audio in isolation, "
        "validates sessions in batch."
    ),
    lifespan=lifespan,
)

# Restrict CORS to specific origins (development and production).
# Note: CORSMiddleware does not support glob/wildcard patterns in allow_origins.
# Only exact literal origins are matched.
origin_whitelist = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "https://huggingface.co",
    "https://mshaiel2004-clario-techniques-module.hf.space",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origin_whitelist,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept"],
)

# Register routes under the /v1 prefix
app.include_router(http_router, prefix="/v1")


@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Clario Unified Assistant (UAB) v2.0",
        "version": "2.0.0",
        "architecture": "stateless REST (thin-client)",
        "core_endpoints": [
            "POST /v1/profile/questionnaire (onboarding)",
            "GET /v1/assessments (assessment manifest with OTA URLs)",
            "GET /v1/assessments/{id}/bundle (download assessment ZIP bundle)",
            "POST /v1/assistant/analyze (stateless audio analysis)",
            "POST /v1/assistant/validate-session (batch error validation)",
            "POST /v1/tts/generate (dynamic TTS generation)",
            "POST /v1/training/generate (generate personalised exercise plan)",
            "GET /v1/training (exercise module manifest)",
            "GET /v1/training/{id}/bundle (download training ZIP bundle)",
            "GET /v1/techniques (techniques manifest with user progress)",
            "GET /v1/techniques/{id}/exercise (exercise session for technique)",
            "GET /v1/techniques/{id}/tts-steps (step narration audio)",
            "POST /v1/techniques/score (score technique recording)",
            "POST /v1/techniques/progress (log practice session)",
            "GET /v1/techniques/{id}/history (past session history)",
        ]
    }
