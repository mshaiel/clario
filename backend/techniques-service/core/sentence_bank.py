import sqlite3
import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'techniques.db')


class SentenceBank:
    _loaded: bool = False

    @classmethod
    def load(cls) -> None:
        """Verify the sentence table is accessible at startup."""
        conn = sqlite3.connect(DB_PATH)
        count = conn.execute('SELECT COUNT(*) FROM technique_sentences').fetchone()[0]
        conn.close()
        cls._loaded = True
        logger.info(f'SentenceBank ready — {count} sentences in DB.')

    @classmethod
    def get(
        cls,
        technique_id: str,
        language: str = 'english',
        difficulty: int = 1,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Fetch sentences for a given technique/language/difficulty.
        Returns a list of dicts with keys: id, sentence, phoneme_focus, word_count, notes.
        """
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        columns = [r[1] for r in conn.execute('PRAGMA table_info(technique_sentences)').fetchall()]
        has_cam_id = 'cam_sentence_id' in columns

        select_fields = 'id, sentence, phoneme_focus, word_count, notes'
        if has_cam_id:
            select_fields += ', cam_sentence_id'

        rows = conn.execute(
            f'''
            SELECT {select_fields}
            FROM technique_sentences
            WHERE technique_id = ?
                AND language = ?
                AND difficulty = ?
            ORDER BY RANDOM()
            LIMIT ?
            ''',
            (technique_id, language, difficulty, limit),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]

    @classmethod
    def get_by_id(cls, sentence_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a single sentence by its primary key."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            'SELECT * FROM technique_sentences WHERE id = ?', (sentence_id,)
        ).fetchone()
        conn.close()
        return dict(row) if row else None
