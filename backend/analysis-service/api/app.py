import logging
import os

# ─── Logging MUST be configured before any other imports ─────────────────────
# If any import below crashes, we need logs to appear.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger("ClarioApp")

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env early so all os.getenv() calls pick it up
load_dotenv()

logger.info("📦 Importing application modules...")
try:
    from api.routes_analysis import router as analysis_router
    from core.asr_models import get_asr_loader
    from core.sentence_bank import get_sentence_bank
    logger.info("✅ All modules imported successfully.")
except Exception as e:
    logger.critical(f"❌ Fatal import error: {e}", exc_info=True)
    raise

# ─── App ──────────────────────────────────────────────────────────────────────
APP_VERSION = "3.0.0"

app = FastAPI(
    title="Clario Speech Therapy API",
    description="Advanced Fluency & Phonology Analysis Engine",
    version=APP_VERSION,
)

# CORS — allow_credentials requires explicit origins, not "*"
# Using allow_credentials=False so wildcard origin works in browsers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Routes
app.include_router(analysis_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_event():
    """Initialize critical components on startup."""
    logger.info("🚀 Starting Clario Analysis API...")

    try:
        # 1. Load Sentence Banks from Firestore
        logger.info("📚 Loading Sentence Banks from Firestore...")
        bank = get_sentence_bank()
        total_sents = sum(len(v) for v in bank.by_type.values())
        if total_sents:
            logger.info(f"✅ Loaded {total_sents} sentences across {len(bank.by_type)} test types.")
        else:
            logger.warning("⚠️ No sentence banks loaded — check Firestore credentials and data.")

        # 2. Load AI Models
        logger.info("🤖 Loading ASR Models (Whisper + Allosaurus + Wav2Vec2)...")
        loader = get_asr_loader()
        loader.load_models()
        logger.info("✅ AI Models ready.")

    except Exception as e:
        logger.critical(f"❌ Startup failed: {e}", exc_info=True)


@app.get("/", tags=["Health"])
async def root():
    return {
        "status": "online",
        "docs_url": "/docs",
        "version": APP_VERSION,
    }
