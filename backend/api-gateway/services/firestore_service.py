"""
Firebase Firestore Service Adapter
Handles all database operations for user profiles, assessments, and validation.

Firestore schema (2 top-level collections):
  sentence_banks/{type}_{lang}                   - sentence bank data (read-only)
  users/{user_id}                                - user profile (full_name, language, selections, ...)
  users/{user_id}/user_assessments/{assess_id}   - assigned assessment metadata
  users/{user_id}/assessment_plans/{assess_id}   - built assessment plan dicts
  users/{user_id}/tensor/data                    - ML learning tensor (JSON-serialised)
  users/{user_id}/validated_errors/{uid}_{test_id} - validated error records (user-scoped)
  users/{user_id}/assessment_progress/{module_id}  - sentence completion progress (written by frontend)
"""
import json
import os
from typing import Dict, List, Optional, Any
from datetime import datetime

from google.cloud import firestore
from google.oauth2 import service_account

from api.schemas import QuestionnaireRequest, Assessment, PracticeModule, ValidateSessionRequest
from .training_service import TrainingService
from utils.logger import get_logger

logger = get_logger("FirestoreService")


def _init_db() -> firestore.AsyncClient:
    # 1. JSON content passed as secret env var (HF Spaces / containerised deployments)
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if creds_json:
        info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(info)
        return firestore.AsyncClient(credentials=creds, project=info.get("project_id"))

    # 2. Path to a service-account key file
    key_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "key.json")
    if os.path.exists(key_path):
        creds = service_account.Credentials.from_service_account_file(key_path)
        return firestore.AsyncClient(credentials=creds)

    # 3. Application Default Credentials (GKE, Cloud Run, etc.)
    return firestore.AsyncClient()


_db: Optional[firestore.AsyncClient] = None


def _get_db() -> firestore.AsyncClient:
    global _db
    if _db is None:
        _db = _init_db()
    return _db


# Human-readable titles for each test_type.
_ASSESS_TITLES: Dict[str, str] = {
    "comprehensive":     "Comprehensive Assessment",
    "velar_fronting":    "Velar Fronting Assessment",
    "blocks":            "Fluency Blocks Assessment",
    "repetitions":       "Repetition & Stuttering Assessment",
    "repetition":        "Repetition & Stuttering Assessment",
    "prolongation":      "Prolongation Assessment",
    "gliding":           "Gliding Assessment",
    "stopping":          "Stopping Assessment",
    "cluster_reduction": "Cluster Reduction Assessment",
    "epenthesis":        "Epenthesis Assessment",
}

_ASSESS_DESCRIPTIONS: Dict[str, str] = {
    "comprehensive":     "Baseline evaluation of the 8 key speech patterns.",
    "velar_fronting":    "Focused evaluation on K and G sound substitutions.",
    "blocks":            "Evaluation of airflow stoppages and tense pauses.",
    "repetitions":       "Evaluation of syllable and whole-word repetitions.",
    "repetition":        "Evaluation of syllable and whole-word repetitions.",
    "prolongation":      "Evaluation of sound prolongations.",
    "gliding":           "Evaluation of r/w gliding errors.",
    "stopping":          "Evaluation of final consonant stopping.",
    "cluster_reduction": "Evaluation of consonant cluster simplification.",
    "epenthesis":        "Evaluation of vowel insertion within consonant clusters.",
}


class FirestoreService:
    """
    Database service for UAB backed by Google Cloud Firestore.
    """

    # ==========================================
    # Questionnaire & Profile Management
    # ==========================================

    @staticmethod
    async def save_questionnaire(req: QuestionnaireRequest) -> bool:
        """Save user's onboarding profile."""
        try:
            await _get_db().collection("users").document(req.user_id).set({
                "full_name": req.full_name,
                "language": req.language,
                "target_persona": req.target_persona,
                "selections": [s.model_dump() for s in req.selections],
                "created_at": datetime.now().isoformat(),
            })
            logger.info(f"✅ Questionnaire saved for {req.user_id}")
            return True
        except Exception as e:
            logger.error(f"❌ save_questionnaire failed for {req.user_id}: {e}")
            return False

    @staticmethod
    async def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve the user's profile document (full_name, language, target_persona, etc.)."""
        try:
            doc = await _get_db().collection("users").document(user_id).get()
            if not doc.exists:
                logger.warning(f"⚠️ User profile not found: {user_id}")
                return None
            return doc.to_dict()
        except Exception as e:
            logger.error(f"❌ get_user_profile failed for {user_id}: {e}")
            return None

    @staticmethod
    async def assign_assessments(user_id: str, selections: List[Any], language: str = "english") -> bool:
        """
        Assign assessments and build assessment plans.
        Plans are stored under assessment_plans/{user_id}/plans/{assess_id}.

        Args:
            user_id: User ID
            selections: List of user selections (with .subtype attribute)
            language: Language code ("english" or "urdu", default: "english")

        Returns:
            True if successful
        """
        # Build ordered list of assess_ids and merge clinical data per id.
        assessment_ids: List[str] = []
        sel_map: Dict[str, Dict[str, List[str]]] = {}  # assess_id -> {focus_phonemes, danger_words}
        for sel in selections:
            subtype = sel.subtype if hasattr(sel, 'subtype') else sel.get('subtype')
            assess_id = f"assess_{subtype}_{language}_v1"
            fp = (sel.focus_phonemes if hasattr(sel, 'focus_phonemes')
                  else sel.get('focus_phonemes', []))
            dw = (sel.danger_words if hasattr(sel, 'danger_words')
                  else sel.get('danger_words', []))
            if assess_id not in sel_map:
                assessment_ids.append(assess_id)
                sel_map[assess_id] = {"focus_phonemes": list(fp), "danger_words": list(dw)}
            else:
                # Merge data from duplicate selections
                sel_map[assess_id]["focus_phonemes"] += [p for p in fp if p not in sel_map[assess_id]["focus_phonemes"]]
                sel_map[assess_id]["danger_words"] += [w for w in dw if w not in sel_map[assess_id]["danger_words"]]

        from core.recommender import recommender

        assessment_meta = []
        plans_col = _get_db().collection("users").document(user_id).collection("assessment_plans")

        for assess_id in assessment_ids:
            test_type = assess_id.replace("assess_", "").replace(f"_{language}_v1", "")
            title = _ASSESS_TITLES.get(test_type, test_type.replace("_", " ").title())
            description = _ASSESS_DESCRIPTIONS.get(test_type, "")
            clinical_data = sel_map.get(assess_id, {})

            try:
                logger.info(f"🔄 Building plan for {assess_id} ({language})...")
                plan = await recommender.build_assessment_plan(
                    test_type=test_type,
                    language=language,
                    module_id=assess_id,
                    title=title,
                    focus_phonemes=clinical_data.get("focus_phonemes", []),
                    danger_words=clinical_data.get("danger_words", []),
                )

                if plan:
                    await plans_col.document(assess_id).set(plan)
                    logger.info(f"✅ Plan stored in Firestore for {assess_id}")
                else:
                    logger.warning(f"⚠️ Empty plan for {assess_id}")

            except Exception as e:
                logger.error(f"❌ Error building plan for {assess_id}: {e}")

            assessment_meta.append({
                "assess_id": assess_id,
                "test_type": test_type,
                "title": title,
                "description": description,
                "language": language,
            })

        try:
            user_assess_col = _get_db().collection("users").document(user_id).collection("user_assessments")
            for meta in assessment_meta:
                await user_assess_col.document(meta["assess_id"]).set(
                    {**meta, "updated_at": datetime.now().isoformat()},
                    merge=True
                )
            logger.info(f"✅ Assigned {len(assessment_ids)} assessments to {user_id} ({language})")
        except Exception as e:
            logger.error(f"❌ Failed to save user_assessments for {user_id}: {e}")
            return False

        return True

    # ==========================================
    # Assessment Manifest (OTA)
    # ==========================================

    @staticmethod
    async def get_user_assessments(user_id: str, language: Optional[str] = None) -> List[Assessment]:
        """Fetch user's assigned assessments, optionally filtered by language."""
        try:
            col = _get_db().collection("users").document(user_id).collection("user_assessments")
            if language:
                query = col.where("language", "==", language)
            else:
                query = col

            assessments: List[Assessment] = []
            async for snap in query.stream():
                meta = snap.to_dict()
                assess_id = meta.get("assess_id", snap.id)
                test_type = meta.get("test_type", "")
                assessments.append(Assessment(
                    id=assess_id,
                    test_type=test_type,
                    title=meta.get("title", _ASSESS_TITLES.get(test_type, assess_id)),
                    description=meta.get("description", _ASSESS_DESCRIPTIONS.get(test_type, "")),
                    language=meta.get("language", language or "english"),
                    version="1.0.0",
                ))

            logger.info(f"📋 Returning {len(assessments)} assessments for {user_id} (language: {language or 'all'})")
            return assessments

        except Exception as e:
            logger.error(f"❌ get_user_assessments failed for {user_id}: {e}")
            return []

    @staticmethod
    async def get_assessment_plan(user_id: str, assess_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve the assessment plan dict for a user's assessment.

        Args:
            user_id: User ID
            assess_id: Assessment ID (e.g., "assess_velar_fronting_v1")

        Returns:
            Plan dict or None if not found
        """
        try:
            doc = await (
                _get_db().collection("users")
                .document(user_id)
                .collection("assessment_plans")
                .document(assess_id)
                .get()
            )
            if not doc.exists:
                logger.warning(f"⚠️ Plan not found: {user_id}/{assess_id}")
                return None
            return doc.to_dict()
        except Exception as e:
            logger.error(f"❌ get_assessment_plan failed for {user_id}/{assess_id}: {e}")
            return None

    # ==========================================
    # Practice Module Manifest (OTA)
    # ==========================================

    # ==========================================
    # User Learning Tensor
    # ==========================================

    @staticmethod
    async def get_user_tensor(user_id: str) -> Optional[List[List[List[float]]]]:
        """Fetch user's ML learning tensor (3x64x9 shape)."""
        try:
            doc = await (
                _get_db().collection("users").document(user_id)
                         .collection("tensor").document("data").get()
            )
            if not doc.exists:
                return None
            raw = doc.to_dict().get("tensor_json")
            return json.loads(raw) if raw else None
        except Exception as e:
            logger.error(f"❌ get_user_tensor failed for {user_id}: {e}")
            return None

    @staticmethod
    async def update_user_tensor(user_id: str, tensor: List[List[List[float]]]) -> bool:
        """Update user's ML learning tensor."""
        try:
            await (
                _get_db().collection("users").document(user_id)
                         .collection("tensor").document("data")
                         .set({
                             "tensor_json": json.dumps(tensor),
                             "updated_at": datetime.now().isoformat(),
                         })
            )
            logger.info(f"📊 Updated tensor for {user_id}")
            return True
        except Exception as e:
            logger.error(f"❌ update_user_tensor failed for {user_id}: {e}")
            return False

    # ==========================================
    # Batch Validation & Active Learning
    # ==========================================

    @staticmethod
    async def process_batch_validation(
        user_id: str,
        validation_data: ValidateSessionRequest
    ) -> bool:
        """
        Process batch validation after session completion.
        Stores validated errors and updates the user's ML tensor.

        Args:
            user_id: User who completed the session
            validation_data: Batch of validated errors and session metadata

        Returns:
            True if processed successfully
        """
        try:
            test_id = validation_data.test_id

            # 1. Store validated errors under the user's subcollection (user-scoped, prevents overwrite bug)
            new_doc_id = f"{user_id}_{test_id}"
            await (
                _get_db().collection("users").document(user_id)
                         .collection("validated_errors").document(new_doc_id)
                         .set({
                             "user_id": user_id,
                             "test_type": validation_data.test_type,
                             "session_accuracy": validation_data.overall_session_accuracy,
                             "error_count": len(validation_data.validated_errors),
                             "errors": [e.model_dump() for e in validation_data.validated_errors],
                             "created_at": datetime.now().isoformat(),
                         })
            )

            # 2. Update user tensor locally (no network hop to CTM)
            current_tensor = await FirestoreService.get_user_tensor(user_id)
            updated_tensor = TrainingService.update_tensor_local(
                current_tensor=current_tensor,
                validated_errors=validation_data.validated_errors,
                test_type=validation_data.test_type,
                correct_phonemes=validation_data.correct_phonemes,
            )
            await FirestoreService.update_user_tensor(user_id, updated_tensor)

            logger.info(
                f"✅ Validated session {test_id}: "
                f"{len(validation_data.validated_errors)} errors, "
                f"accuracy: {validation_data.overall_session_accuracy}%"
            )
            return True

        except Exception as e:
            logger.error(f"❌ Error processing batch validation: {e}")
            return False

    # ==========================================
    # Training Plans (Exercise Strategy)
    # ==========================================

    @staticmethod
    async def store_training_plans(
        user_id: str,
        plans: List[Dict[str, Any]],
    ) -> bool:
        """
        Persist a list of training-plan dicts for a user (one per disorder).

        Each plan must have a 'module_id' field.
        Existing plans are overwritten (regeneration replaces old plans).

        Args:
            user_id: Target user
            plans:   List of normalised plan dicts produced from CTM exercise_sets

        Returns:
            True if all writes succeeded
        """
        try:
            col = (
                _get_db()
                .collection("users")
                .document(user_id)
                .collection("training_plans")
            )
            
            # Delete old training plans
            old_docs = await col.get()
            for doc in old_docs:
                await doc.reference.delete()
                
            for plan in plans:
                module_id = plan.get("module_id", "")
                if not module_id:
                    logger.warning("⚠️ Skipping training plan with missing module_id")
                    continue
                await col.document(module_id).set(
                    {**plan, "updated_at": datetime.now().isoformat()}
                )
                logger.info(f"✅ Training plan stored: {user_id}/{module_id}")
            return True
        except Exception as e:
            logger.error(f"❌ store_training_plans failed for {user_id}: {e}")
            return False

    @staticmethod
    async def get_training_plan(
        user_id: str,
        module_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve one training plan by module_id.

        Args:
            user_id:   Target user
            module_id: e.g. "train_velar_fronting_001"

        Returns:
            Plan dict or None if not found
        """
        try:
            doc = await (
                _get_db()
                .collection("users")
                .document(user_id)
                .collection("training_plans")
                .document(module_id)
                .get()
            )
            if not doc.exists:
                logger.warning(f"⚠️ Training plan not found: {user_id}/{module_id}")
                return None
            return doc.to_dict()
        except Exception as e:
            logger.error(f"❌ get_training_plan failed for {user_id}/{module_id}: {e}")
            return None

    @staticmethod
    async def get_user_training_modules(
        user_id: str,
        language: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        List all training plans stored for a user.

        Args:
            user_id:  Target user
            language: Optional filter ("english" or "urdu")

        Returns:
            List of lightweight module-summary dicts
            (id, error_name, major_type, severity, language, level_count, status)
        """
        try:
            col = (
                _get_db()
                .collection("users")
                .document(user_id)
                .collection("training_plans")
            )
            if language:
                query = col.where("language", "==", language.lower())
            else:
                query = col

            modules: List[Dict[str, Any]] = []
            async for snap in query.stream():
                data = snap.to_dict()
                modules.append(
                    {
                        "id":          data.get("module_id", snap.id),
                        "error_name":  data.get("error_name", ""),
                        "major_type":  data.get("major_type", ""),
                        "severity":    data.get("severity", 0.0),
                        "language":    data.get("language", language or "english"),
                        "level_count": len(data.get("levels", [])),
                        "status":      data.get("status", "pending"),
                    }
                )

            logger.info(
                f"📚 Returning {len(modules)} training modules "
                f"for {user_id} (language: {language or 'all'})"
            )
            return modules
        except Exception as e:
            logger.error(f"❌ get_user_training_modules failed for {user_id}: {e}")
            return []

