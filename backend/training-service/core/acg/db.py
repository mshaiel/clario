import os
import sqlite3
import random
from typing import List, Dict, Optional, Union

from config import DIFF_MAP

# ==============================================================================
# ROBUST PATH FINDING
# ==============================================================================
def find_db_path():
    """
    Tries multiple strategies to locate the database file.
    """
    filename = "clario.db"
    
    # Strategy 1: Relative to this file (Modular Structure: core/acg/db.py -> root)
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path_1 = os.path.join(base_dir, filename)
    
    # Strategy 2: Current Working Directory
    path_2 = os.path.join(os.getcwd(), filename)
    
    # Strategy 3: Explicit Docker Path
    path_3 = f"/app/{filename}"
    
    candidates = [path_1, path_2, path_3]
    
    # Require at least 10 KB — an LFS pointer file is only ~130 bytes
    for path in candidates:
        if os.path.exists(path) and os.path.getsize(path) > 10000:
            return path

    return path_1

DB_PATH = find_db_path()


class LexiconMiner:
    def __init__(self):
        self.conn = None
        self.db_path = DB_PATH
        self.connect_error = None
        self._connect()

    def _connect(self):
        print(f"🔍 ACG: Looking for DB at {DB_PATH}")
        if os.path.exists(DB_PATH) and os.path.getsize(DB_PATH) > 10000:
            # --- Step 1: connect + health check (read-only safe) ---
            try:
                self.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
                self.conn.row_factory = sqlite3.Row
                cur = self.conn.cursor()
                cur.execute("SELECT count(*) FROM lexicon")
                count = cur.fetchone()[0]
                print(f"✅ ACG: DB Connected. Loaded {count} entries (V3 Schema).")
            except Exception as e:
                print(f"❌ ACG DB Error: {e}")
                self.connect_error = str(e)
                self.conn = None
                return

            # --- Step 2: performance indexes (write — skipped on read-only FS) ---
            try:
                cur = self.conn.cursor()
                cur.execute("CREATE INDEX IF NOT EXISTS idx_final_phoneme ON lexicon(final_phoneme)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_lang_final ON lexicon(lang, final_phoneme)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_lang_onset ON lexicon(lang, onset_type)")
                self.conn.commit()
                print("✅ ACG: DB indexes verified.")
            except Exception as idx_err:
                # HF Space runs on a read-only filesystem — indexes can't be written
                # but the DB is still fully usable for SELECT queries.
                print(f"⚠️ ACG: Index creation skipped (read-only FS?): {idx_err}")
        else:
            print(f"⚠️ ACG: DB file missing or too small. Mocking will be active.")
            self.conn = None

    def get_lang_code(self, language: str):
        # Database uses UPPERCASE 'EN' and 'UR'
        return 'UR' if 'urdu' in language.lower() else 'EN'

    def fetch_words(self, 
                   target_phoneme: str, 
                   language: str, 
                   difficulty: int, 
                   structure: str = None, 
                   pos: Union[str, List[str]] = None, 
                   count: int = 5,
                   min_syllables: int = None, 
                   strict: bool = True,
                   onset_type: str = None, 
                   phoneme_position: str = "initial",
                   tag: str = None,
                   forbidden_phonemes: List[str] = None,
                   explicit_min_freq: int = None) -> List[Dict]:
        """
        V3 Smart Fetch utilizing precise columns (initial_phoneme, freq, tags).
        """
        iso = self.get_lang_code(language)

        forbidden_set = set(forbidden_phonemes or [])
        if target_phoneme in forbidden_set:
            forbidden_set.remove(target_phoneme)
        
        # --- MOCK FALLBACK ---
        def get_mock():
            return [{
                "word": f"mock_{target_phoneme}_{i}",
                "clean_ipa": f"{target_phoneme} e s t",
                "ipa": f"{target_phoneme} e s t",
                "pos": pos if isinstance(pos, str) else "Noun",
                "syllables": min_syllables or 1,
                "tags": tag or "General",
                "structure": structure or "CVC"
            } for i in range(count)]

        if not self.conn: 
            return get_mock()
        
        # 1. Determine Difficulty & Frequency
        min_d, max_d, mapped_min_freq = DIFF_MAP.get(difficulty, (0.0, 1.0, 0))
        # Allow override if strategy explicitly demands high freq (e.g. Auditory Bombardment)
        final_min_freq = explicit_min_freq if explicit_min_freq is not None else mapped_min_freq
        
        # Base Query
        base_sql = "SELECT word, clean_ipa as ipa, syllables, pos, tags, structure, onset_type, freq FROM lexicon"
        constraints = ["lang = ?"]
        params = [iso]

        # 2. FREQUENCY CONSTRAINT (V3 Feature)
        if final_min_freq > 0:
            constraints.append("freq >= ?")
            params.append(final_min_freq)

        # 3. PRECISE POSITION LOGIC (V3 Feature)
        # Uses indexed columns instead of slow LIKE %...% queries
        if phoneme_position == "initial":
            constraints.append("initial_phoneme = ?")
            params.append(target_phoneme)
        elif phoneme_position == "final":
            constraints.append("final_phoneme = ?")
            params.append(target_phoneme)
        elif phoneme_position == "medial":
            # Medial is a sequence, so LIKE is still appropriate here, but we check it's NOT initial
            constraints.append("medial_phoneme LIKE ?")
            params.append(f"%{target_phoneme}%")

        # 4. CLINICAL CONSTRAINTS
        if onset_type:
            constraints.append("onset_type = ?")
            params.append(onset_type)

        if structure and structure != "Complex":
            constraints.append("structure = ?")
            params.append(structure)
        elif structure == "Complex":
            constraints.append("structure IN ('Complex', 'CCV', 'VCC', 'CCCV')")

        if pos:
            if isinstance(pos, list):
                placeholders = ','.join(['?'] * len(pos))
                constraints.append(f"pos IN ({placeholders})")
                params.extend(pos)
            else:
                constraints.append("pos = ?")
                params.append(pos)
            
        if min_syllables:
            constraints.append("syllables >= ?")
            params.append(min_syllables)

        # 5. SEMANTIC TAGGING (V3 Feature)
        if tag:
            constraints.append("tags LIKE ?")
            params.append(f"%{tag}%")

        # 6. FORBIDDEN SOUNDS / TRAP MASKING (AEG Integration)
        if forbidden_phonemes:
            for bad_sound in forbidden_phonemes:
                # Ensure the word doesn't contain the forbidden sound anywhere
                constraints.append("clean_ipa NOT LIKE ?")
                params.append(f"%{bad_sound}%")

        # 7. DIFFICULTY RANGE
        diff_constraint = "difficulty BETWEEN ? AND ?"
        diff_params = [min_d, max_d]

        try:
            cur = self.conn.cursor()

            # ATTEMPT 1: Strict (All constraints including Difficulty)
            full_sql = f"{base_sql} WHERE {' AND '.join(constraints)} AND {diff_constraint} ORDER BY RANDOM() LIMIT ?"
            cur.execute(full_sql, tuple(params + diff_params + [count]))
            results = [dict(r) for r in cur.fetchall()]
            
            if len(results) >= count or (len(results) > 0 and strict):
                return results

            # ATTEMPT 2: Relaxed Difficulty (Keep Clinical/Phonetic constraints)
            # We relax difficulty first because clinical correctness > difficulty precision
            if strict:
                relaxed_sql = f"{base_sql} WHERE {' AND '.join(constraints)} ORDER BY RANDOM() LIMIT ?"
                cur.execute(relaxed_sql, tuple(params + [count]))
                relaxed_results = [dict(r) for r in cur.fetchall()]
                if relaxed_results: return relaxed_results

            # ATTEMPT 3: Fallback to simple Phoneme Match (Last Resort)
            # Only keeps target phoneme and language. Keeps difficulty constraint!
            if phoneme_position == "final":
                fallback_constraints = ["final_phoneme = ?", "lang = ?", diff_constraint]
                fallback_params = [target_phoneme, iso] + diff_params
            elif phoneme_position == "medial":
                fallback_constraints = ["medial_phoneme LIKE ?", "lang = ?", diff_constraint]
                fallback_params = [f"%{target_phoneme}%", iso] + diff_params
            else:
                fallback_constraints = ["initial_phoneme = ?", "lang = ?", diff_constraint]
                fallback_params = [target_phoneme, iso] + diff_params

            for bad_sound in forbidden_set:
                fallback_constraints.append("clean_ipa NOT LIKE ?")
                fallback_params.append(f"%{bad_sound}%")

            fallback_sql = (
                "SELECT word, clean_ipa as ipa, syllables, pos, tags, structure, freq "
                f"FROM lexicon WHERE {' AND '.join(fallback_constraints)} "
                "ORDER BY RANDOM() LIMIT ?"
            )
            cur.execute(fallback_sql, tuple(fallback_params + [count]))
            last_res = [dict(r) for r in cur.fetchall()]
            
            if last_res: return last_res

            # Since AEG always passes top 3 forbidden targets, 
            # we must fall back to mock content to prevent empty levels.
            return get_mock()

        except Exception as e:
            print(f"   ❌ Query Failed: {e}")
            return get_mock()

    def fetch_minimal_pair_foil(self, target_word_row: Dict, foil_sound: str, language: str, difficulty: int = 3) -> Optional[Dict]:
        """
        Attempts to find a true minimal pair. 
        Falls back to pseudo minimal pairs (same structure + rhyme), then returns None.
        """
        if not self.conn:
            return {
                "word": f"mock_{foil_sound}_pair",
                "ipa": f"{foil_sound} e s t",
                "tags": "General",
            }
        
        iso = self.get_lang_code(language)
        target_ipa = target_word_row.get('ipa', target_word_row.get('clean_ipa', ''))
        phones = target_ipa.split()
        
        min_d, max_d, _ = DIFF_MAP.get(difficulty, (0.0, 1.0, 0))
        
        try:
            cur = self.conn.cursor()
            
            if phones:
                # 1. True Minimal Pair (Constrained by difficulty)
                phones[0] = foil_sound
                expected_foil_ipa = " ".join(phones)
                
                sql_strict = "SELECT word, clean_ipa as ipa, tags FROM lexicon WHERE clean_ipa = ? AND lang = ? AND difficulty BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1"
                cur.execute(sql_strict, (expected_foil_ipa, iso, min_d, max_d))
                row = cur.fetchone()
                if row: return dict(row)
                
                # 1b. True Minimal Pair (Relaxed difficulty)
                sql_strict_relaxed = "SELECT word, clean_ipa as ipa, tags FROM lexicon WHERE clean_ipa = ? AND lang = ? ORDER BY RANDOM() LIMIT 1"
                cur.execute(sql_strict_relaxed, (expected_foil_ipa, iso))
                row = cur.fetchone()
                if row: return dict(row)
                
            # 2. Pseudo Minimal Pair (Matches onset, structure, syllables, and final sound)
            target_struct = target_word_row.get('structure', 'CVC')
            target_syl = target_word_row.get('syllables', 1)
            target_final = target_word_row.get('final_phoneme')
            if not target_final and phones and len(phones) > 1:
                target_final = phones[-1]
                
            if target_final:
                sql_pseudo = "SELECT word, clean_ipa as ipa, tags FROM lexicon WHERE initial_phoneme = ? AND lang = ? AND structure = ? AND syllables = ? AND clean_ipa LIKE ? AND difficulty BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1"
                cur.execute(sql_pseudo, (foil_sound, iso, target_struct, target_syl, f"%{target_final}", min_d, max_d))
                row = cur.fetchone()
                if row: return dict(row)
                
                sql_pseudo_relaxed = "SELECT word, clean_ipa as ipa, tags FROM lexicon WHERE initial_phoneme = ? AND lang = ? AND structure = ? AND syllables = ? AND clean_ipa LIKE ? ORDER BY RANDOM() LIMIT 1"
                cur.execute(sql_pseudo_relaxed, (foil_sound, iso, target_struct, target_syl, f"%{target_final}"))
                row = cur.fetchone()
                if row: return dict(row)

        except Exception as e:
            print(f"Minimal pair error: {e}")
            pass
            
        return None