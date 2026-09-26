import asyncio
import os
from typing import Any, Dict, List, Optional

import numpy as np
import httpx

from core.tensor_bridge import TensorBridge
from utils.logger import get_logger

logger = get_logger("TrainingService")

TRAINING_MODULE_URL = os.getenv(
    "TRAINING_MODULE_URL",
    "https://junaiddbz-clario-training-module.hf.space",
).rstrip("/")
TRAINING_TIMEOUT  = float(os.getenv("TRAINING_TIMEOUT",  "30"))
TRAINING_RETRIES  = int(os.getenv("TRAINING_RETRIES",    "3"))
TRAINING_LEARNING_RATE = float(os.getenv("TRAINING_LEARNING_RATE", "0.2"))

# Singleton bridge — stateless, safe to share
_bridge = TensorBridge()

# ── Clinical process → canonical error name that TensorBridge understands ────
# Maps the `process` field emitted by the Analysis Module (lowercase, underscored)
# to the error-column names expected by TensorBridge's ERROR_MAP.
_PROCESS_TO_ERROR: Dict[str, str] = {
    # Articulation / Phonological errors
    "stopping":          "stopping",
    "velar_fronting":    "velar_fronting",
    "velar fronting":    "velar_fronting",
    "gliding":           "gliding",
    "cluster_reduction": "cluster_reduction",
    "cluster reduction": "cluster_reduction",
    "epenthesis":        "epenthesis",
    "substitution":      "substitution",
    "omission":          "substitution",   # generic column for omission
    "addition":          "substitution",   # generic column for addition
    # Bug 5 fix: fluency error types were completely missing.  All three
    # fluency disorders map to their own columns (6, 7, 8) in TensorBridge.
    # Without these entries the tensor always received a "substitution" fallback,
    # making it impossible for CTM to ever diagnose or train fluency disorders.
    "blocks":            "blocks",         # column 6 — BlockError.error_type = "block"
    "block":             "blocks",         # column 6
    "blocking":          "blocks",         # column 6
    "prolongation":      "prolongation",   # column 7 — ProlongationError.error_type
    "prolong":           "prolongation",   # column 7
    "repetition":        "repetition",     # column 8
    "repetitions":       "repetition",     # column 8
    "repeat":            "repetition",     # column 8
    "stutter":           "repetition",     # column 8 — StutterError.error_type = "stutter"
}


# Maps session test_type → error name (used as fallback when `process` field absent)
_TEST_TYPE_TO_ERROR: Dict[str, str] = {
    "stopping":          "stopping",
    "velar_fronting":    "velar_fronting",
    "gliding":           "gliding",
    "cluster_reduction": "cluster_reduction",
    "epenthesis":        "epenthesis",
    "blocks":            "blocks",
    "repetition":        "repetition",
    "repetitions":       "repetition",
    "prolongation":      "prolongation",
    # "comprehensive" is intentionally absent → use per-error process field
}


class TrainingService:
    """Connector for the Clario Training Module (CTM) + local tensor management."""

    @staticmethod
    def backend_url() -> str:
        return TRAINING_MODULE_URL

    # ══════════════════════════════════════════════════════════════════════════
    # TENSOR UPDATE  (now local — no HTTP to CTM)
    # ══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def update_tensor_local(
        current_tensor: Optional[List[List[List[float]]]],
        validated_errors: List[Any],
        test_type: str = "",
        learning_rate: float = TRAINING_LEARNING_RATE,
        correct_phonemes: Optional[List[str]] = None,
    ) -> List[List[List[float]]]:
        """
        Update the user's learning tensor locally using the embedded TensorBridge.

        This replaces the old HTTP call to CTM /tensor/update.

        Args:
            current_tensor:   Existing 3×64×9 tensor (None → fresh tensor).
            validated_errors: Confirmed error objects from the session.
            test_type:        Session test type (e.g. "stopping").  Used as
                              fallback clinical error classification when the
                              per-error `process` field is absent.
            learning_rate:    EMA alpha for the update.

        Returns:
            Updated tensor as a nested list (3×64×9).
        """
        events = TrainingService._build_tensor_events(validated_errors, test_type, correct_phonemes or [])
        logger.info(
            "Local tensor update: %s events from %s validated errors (test_type=%r)",
            len(events), len(validated_errors), test_type,
        )
        updated = _bridge.update_tensor(current_tensor, events, learning_rate)
        return updated

    @staticmethod
    def _build_tensor_events(
        validated_errors: List[Any],
        test_type: str = "",
        correct_phonemes: List[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Translate UAB validated-error objects and correct phonemes into TensorBridge event dicts.

        Error-type resolution priority:
          1. `process` field from the error (populated by Analysis Module,
             preserved through ValidatedError.process).
          2. Session `test_type` (when not "comprehensive").
          3. `error_type` field on the error object itself.
          4. Generic "substitution" fallback.
        """
        if correct_phonemes is None:
            correct_phonemes = []
        events: List[Dict[str, Any]] = []
        test_type_lower = test_type.lower().strip()

        for err in validated_errors:
            # Normalise to dict
            if hasattr(err, "model_dump"):
                item = err.model_dump()
            elif isinstance(err, dict):
                item = err
            else:
                continue

            # ── Determine the target phoneme ──────────────────────────────────
            phoneme = (
                item.get("expected_phoneme")
                or item.get("phoneme_prolonged")
                or item.get("preceding_phoneme")
                or item.get("heard_phoneme")
            )
            if not phoneme:
                logger.warning(
                    "Skipping tensor event — missing phoneme (word=%r, error_type=%r)",
                    item.get("word", ""), item.get("error_type", ""),
                )
                continue

            # ── Determine the clinical error type ─────────────────────────────
            # 1. `process` field: the Analysis Module knows the exact clinical process
            #    (e.g. "stopping", "velar_fronting") and stores it in ValidatedError.process.
            process_raw = str(item.get("process") or "").lower().strip()
            error_name = _PROCESS_TO_ERROR.get(process_raw, "")

            # 2. Session test_type — reliable for focused (non-comprehensive) assessments
            if not error_name and test_type_lower in _TEST_TYPE_TO_ERROR:
                error_name = _TEST_TYPE_TO_ERROR[test_type_lower]

            # 3. error_type field on the validated error itself
            if not error_name:
                error_type_raw = str(item.get("error_type") or "").lower().strip()
                error_name = _PROCESS_TO_ERROR.get(error_type_raw, "substitution")

            position = str(item.get("position", "initial")).lower()

            events.append({
                "phoneme":    phoneme,
                "error_type": error_name,
                "position":   position,
                "is_correct": False,   # validate-session only carries confirmed errors
            })

        # Append success events
        for cp in correct_phonemes:
            events.append({
                "phoneme": cp,
                "error_type": "correct",
                "position": "initial",
                "is_correct": True
            })

        return _bridge.parse_events(events)

    # ══════════════════════════════════════════════════════════════════════════
    # STRATEGY GENERATION  (still delegates to CTM via HTTP)
    # ══════════════════════════════════════════════════════════════════════════

    @staticmethod
    async def generate_strategy(
        current_tensor: List[List[List[float]]],
        user_stats: Dict[str, float],
        language: str = "english",
        force_easier: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """
        Call CTM POST /strategy/generate and return the exercise plan dict.

        Returns:
            The full response dict from CTM (status, language, exercise_sets)
            or None when CTM reports no significant errors ('healthy' status).

        Raises:
            RuntimeError on backend unavailability or bad responses.
        """
        payload: Dict[str, Any] = {
            "current_tensor": current_tensor,
            "user_stats":     user_stats,
            "language":       language,
            "force_easier":   force_easier,
        }

        async with httpx.AsyncClient(timeout=TRAINING_TIMEOUT) as client:
            for attempt in range(TRAINING_RETRIES):
                try:
                    logger.info(
                        "CTM strategy/generate attempt %s/%s → %s",
                        attempt + 1, TRAINING_RETRIES, TRAINING_MODULE_URL,
                    )
                    response = await client.post(
                        f"{TRAINING_MODULE_URL}/strategy/generate",
                        json=payload,
                    )
                    response.raise_for_status()
                    body = response.json()

                    status = body.get("status")
                    if status == "healthy":
                        logger.info("CTM: no significant errors — no strategy generated")
                        return None
                    if status != "generated":
                        raise RuntimeError(
                            f"CTM strategy/generate returned unexpected status: {status!r}"
                        )

                    logger.info(
                        "CTM strategy generated: %s exercise sets",
                        len(body.get("exercise_sets", [])),
                    )
                    return body

                except httpx.HTTPStatusError as exc:
                    code = exc.response.status_code
                    if code >= 500 and attempt < TRAINING_RETRIES - 1:
                        wait = 2 ** attempt
                        logger.warning("CTM returned %s, retrying in %ss", code, wait)
                        await asyncio.sleep(wait)
                        continue
                    detail = exc.response.text[:300] if exc.response is not None else str(exc)
                    raise RuntimeError(
                        f"CTM strategy/generate failed with HTTP {code}: {detail}"
                    ) from exc

                except httpx.RequestError as exc:
                    if attempt < TRAINING_RETRIES - 1:
                        wait = 2 ** attempt
                        logger.warning("CTM request error, retrying in %ss: %s", wait, exc)
                        await asyncio.sleep(wait)
                        continue
                    raise RuntimeError(
                        "CTM strategy/generate unavailable after retries"
                    ) from exc

                except RuntimeError:
                    raise

                except Exception as exc:
                    raise RuntimeError(f"CTM strategy/generate failed: {exc}") from exc

        raise RuntimeError("CTM strategy/generate unavailable")



    # ══════════════════════════════════════════════════════════════════════════
    # (REMOVED) update_tensor — old HTTP-to-CTM path
    # Kept as a dead stub so imports don't break during rollout.
    # Remove this stub once firestore_service is updated to call
    # update_tensor_local() directly.
    # ══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _validate_tensor_shape(tensor: Any) -> None:
        if not isinstance(tensor, list) or len(tensor) != 3:
            raise RuntimeError("Invalid tensor shape (expected 3×64×9)")
        for pos_slice in tensor:
            if not isinstance(pos_slice, list) or len(pos_slice) != 64:
                raise RuntimeError("Invalid tensor shape (expected 3×64×9)")
            for err_slice in pos_slice:
                if not isinstance(err_slice, list) or len(err_slice) != 9:
                    raise RuntimeError("Invalid tensor shape (expected 3×64×9)")
