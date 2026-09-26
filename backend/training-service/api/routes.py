"""
api/routes.py — HTTP route definitions. Each handler is a thin delegator:
validate input → call service → return result.

NOTE: /tensor/update has been removed. Tensor updates are now handled
locally inside the Clario Unified Assistant (CUA). This service only
serves /strategy/generate.
"""
import uuid
from fastapi import APIRouter, HTTPException, Request

from schemas import StrategyGeneratePayload
from services.strategy_service import run_strategy_pipeline

router = APIRouter()


@router.get("/")
def health(request: Request):
    from config import VERSION
    return {"status": "online", "version": VERSION, "docs": "/docs"}


@router.post("/strategy/generate")
async def generate_strategy(payload: StrategyGeneratePayload, request: Request):
    models        = request.app.state.models
    validity_mask = request.app.state.validity_mask
    try:
        result = await run_strategy_pipeline(payload, models, validity_mask)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if result.get("status") == "generated":
        result["session_id"] = f"sess_{uuid.uuid4().hex[:8]}"
    return result
