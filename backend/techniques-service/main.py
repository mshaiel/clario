import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.router import router
from core.technique_bank import TechniqueBank
from core.sentence_bank import SentenceBank
from services.progress_service import ProgressService
from core.scoring.repair_detector import RepairDetector

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info('Loading TechniqueBank...')
    TechniqueBank.load()
    logger.info('Loading SentenceBank...')
    SentenceBank.load()
    logger.info('Initializing Firestore...')
    ProgressService.initialize()
    logger.info('Pre-loading Silero VAD model...')
    RepairDetector.preload()  # Loads silero-vad into memory at startup
    logger.info('CTkM ready.')
    yield


app = FastAPI(
    title='Clario Techniques Module',
    version='1.0.0',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],  # Tighten in production to CUA domain only
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.get("/")
def read_root():
    return {"status": "ok", "service": "clario-techniques-module"}

app.include_router(router, prefix='/api')
