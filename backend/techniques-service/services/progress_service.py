import firebase_admin
import sqlite3
import json
import datetime
import os
import logging
from firebase_admin import credentials, firestore
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'techniques.db')

_db = None


class ProgressService:

    @staticmethod
    def initialize() -> None:
        """Progress persistence disabled. Frontend is source of truth."""
        logger.info('ProgressService disabled: frontend handles progress persistence.')

    @staticmethod
    async def get_user_summary(user_id: str) -> Dict[str, Dict[str, Any]]:
        """
        Returns dict of {technique_id: {count, last_score, last_date}}
        for all techniques a user has practiced.
        """
        return {}

    @staticmethod
    async def log_session(
        user_id: str,
        technique_id: str,
        score: Optional[float],
        duration_sec: int,
        session_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """No-op: progress persistence disabled (frontend handles it)."""
        return {
            'success': True,
            'sessions_completed': 0,
            'lifetime_avg_score': None,
        }

    @staticmethod
    async def get_history(
        user_id: str,
        technique_id: str,
        limit: int = 20,
    ):
        """No-op: history is handled by frontend/Firebase directly."""
        return []
