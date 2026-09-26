import os
import numpy as np
from contextlib import asynccontextmanager
from fastapi import FastAPI

from config import DEVICE, AMLM_PATH, AEG_PATH, VERSION
from core.amlm import load_amlm_model, build_validity_mask
from core.aeg import load_aeg_model
from core.triage import TriageEngineV2
from core.acg import ACGEngine
from api.routes import router

# ==========================================
# 1. LIFECYCLE
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"🚀 Initializing Clario Training Module V{VERSION}...")
    try:
        app.state.models = {
            'amlm':   load_amlm_model(AMLM_PATH, DEVICE),
            'aeg':    load_aeg_model(AEG_PATH, DEVICE),
            'triage': TriageEngineV2(DEVICE),
            'acg':    ACGEngine(api_key=os.environ.get("GEMINI_API_KEY")),
        }
        app.state.validity_mask = build_validity_mask()   # (3, 64, 9) float32
        print("✅ System Ready.")
    except Exception as e:
        print(f"❌ Startup Failed: {e}")
        raise
    yield
    # Graceful teardown: close persistent HTTP client used by LLM
    acg = app.state.models.get('acg')
    if acg and hasattr(acg.llm, '_client'):
        await acg.llm._client.aclose()

# ==========================================
# 2. APP
# ==========================================
app = FastAPI(title="Clario Training Module", version=VERSION, lifespan=lifespan)
app.include_router(router)

