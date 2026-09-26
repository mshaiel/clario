import sqlite3
import os
import json
import logging
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'techniques.db')


class TechniqueBank:
    _techniques: Dict[str, Dict[str, Any]] = {}
    _loaded: bool = False

    @classmethod
    def load(cls) -> None:
        """Load all techniques from SQLite into memory at startup."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM techniques ORDER BY display_order').fetchall()
        conn.close()
        cls._techniques = {row['id']: dict(row) for row in rows}
        cls._loaded = True
        logger.info(f'TechniqueBank loaded {len(cls._techniques)} techniques.')

    @classmethod
    def get_all(cls, disorder: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return all techniques, optionally filtered by disorder."""
        if not cls._loaded:
            cls.load()
        techs = list(cls._techniques.values())
        if disorder:
            techs = [t for t in techs if t['disorder'] == disorder]
        return sorted(techs, key=lambda t: t.get('display_order', 0))

    @classmethod
    def get_by_id(cls, technique_id: str) -> Optional[Dict[str, Any]]:
        """Return a single technique dict by ID, or None if not found."""
        if not cls._loaded:
            cls.load()
        return cls._techniques.get(technique_id)
