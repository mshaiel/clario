import sqlite3
import json

db_path = "core/acg/clario.db" # Wait, db.py finds it in the base dir or /app. It's likely in the root dir.
db_path = "clario.db"
try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT word, clean_ipa as ipa, initial_phoneme FROM lexicon WHERE initial_phoneme='f' LIMIT 10")
    rows = [dict(r) for r in cur.fetchall()]
    print(json.dumps(rows, indent=2))
except Exception as e:
    print("Error:", e)
