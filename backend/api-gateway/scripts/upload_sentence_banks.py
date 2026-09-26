"""
Upload all sentence banks to Firestore from audio_assets/sentence_banks/manifest.json.

This replaces the old data/*.json upload. The new manifest includes word-level
audio file paths ("file" key on each word entry), which the recommender uses to
populate words_audio in build_assessment_plan().

Firestore structure (unchanged):
  Collection: sentence_banks
  Documents:  blocks_english, blocks_urdu, prolongation_english, ...
  Fields:     test_type, language, sentences (array)

Run from the project root: python scripts/upload_sentence_banks.py
"""
import json
import os
import sys

from google.cloud import firestore
from google.oauth2 import service_account

KEY_PATH     = "key.json"
MANIFEST_PATH = os.path.join("audio_assets", "sentence_banks", "manifest.json")


def main():
    if not os.path.exists(KEY_PATH):
        print(f"ERROR: {KEY_PATH} not found.")
        sys.exit(1)

    if not os.path.exists(MANIFEST_PATH):
        print(f"ERROR: manifest not found at {MANIFEST_PATH}")
        sys.exit(1)

    print(f"Connecting to Firestore using {KEY_PATH}...")
    creds = service_account.Credentials.from_service_account_file(KEY_PATH)
    db = firestore.Client(credentials=creds)
    print("Connected.\n")

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    uploaded = 0
    skipped  = 0

    for language in ("english", "urdu"):
        lang_data = manifest.get(language, {})
        for test_type, sentences in lang_data.items():
            if not sentences:
                print(f"  SKIP (empty): {test_type}_{language}")
                skipped += 1
                continue

            doc_id = f"{test_type}_{language}"
            db.collection("sentence_banks").document(doc_id).set({
                "test_type":  test_type,
                "language":   language,
                "sentences":  sentences,
            })
            # Count how many sentences have word file paths
            with_files = sum(
                1 for s in sentences
                if any("file" in w for w in s.get("words", []))
            )
            print(f"  OK  {doc_id:40s} ({len(sentences)} sentences, "
                  f"{with_files}/{len(sentences)} with word audio)")
            uploaded += 1

    print(f"\nDone. {uploaded} documents uploaded, {skipped} skipped.")


if __name__ == "__main__":
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_root)
    main()
