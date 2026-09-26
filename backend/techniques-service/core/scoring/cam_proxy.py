import httpx
import os
import json
import re
from typing import Dict, Any, Optional

# ─── Pre-mapped phonetic targets (Urdu + English technique sentences) ─────────
TARGETS_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'technique_targets.json')

try:
    with open(TARGETS_FILE, 'r', encoding='utf-8') as f:
        TECHNIQUE_TARGETS = json.load(f)
except Exception as e:
    TECHNIQUE_TARGETS = {}
    print(f"Warning: Could not load technique targets: {e}")

# CAM_URL must be set as a HuggingFace Space secret — never hardcode.
CAM_BASE_URL = os.getenv('CAM_URL', 'https://junaiddbz-clario-analysis-module.hf.space')

# ─── Test-type classification (must match pipeline_manager.py) ────────────────
# These tests score based on PHONEME accuracy — they REQUIRE IPA targets to be
# meaningful.  If a sentence has no IPA targets, they will score incorrectly.
_PHONOLOGY_TESTS = {'velar_fronting', 'stopping', 'gliding', 'cluster_reduction', 'epenthesis'}

# These tests score based on the ABSENCE of disfluency events.  "No blocks
# detected" = 100 %.  This is fine for the fluency assessment (Tests tab), where
# the sentences are seeded in Firestore.  But for technique practice the user is
# supposed to read a sentence — not stutter — so zero events will always yield
# 100 %, regardless of whether they said the right words.
_FLUENCY_TESTS = {'blocks', 'prolongation', 'repetition'}


def _build_targets(sentence: str) -> list:
    """
    Return a word-level targets list for the given sentence.
    Looks up technique_targets.json first (which contains real IPA for all seeded
    technique sentences).  Falls back to empty-IPA placeholders so CAM can still
    build its SentenceEntry and run word-level alignment.
    """
    if sentence in TECHNIQUE_TARGETS:
        return TECHNIQUE_TARGETS[sentence]

    clean = re.sub(r'[^\w\s]', '', sentence)
    return [{"word": w.strip(), "expected_ipa": []} for w in clean.split() if w.strip()]


def _resolve_test_type(requested: str, targets: list) -> str:
    """
    Choose the correct test_type to send to CAM for technique practice.

    Rules
    ─────
    1. Phonology test + sentence HAS IPA targets
         → Use the requested test (e.g. velar_fronting, stopping).
           CAM's SODA scorer will measure whether the specific error pattern was
           corrected, which is exactly what the technique is training.

    2. Phonology test + sentence has NO IPA targets
         → Fall back to 'comprehensive'.
           Without IPA we cannot do phoneme-level comparison; word-level
           alignment is the best we can do.

    3. Fluency test (blocks / prolongation / repetition) — regardless of IPA
         → Always use 'comprehensive'.
           Fluency tests score the ABSENCE of disfluency events.  In technique
           practice the user reads a sentence without intentional stuttering, so
           these detectors will always find zero events → 100 % score, which is
           meaningless.  Word-level alignment ("did they say the right words?")
           is a far better proxy for technique compliance.

    4. Anything else (already 'comprehensive', unknown type)
         → Pass through unchanged.
    """
    has_ipa = any(len(t.get('expected_ipa', [])) > 0 for t in targets)

    if requested in _PHONOLOGY_TESTS:
        if has_ipa:
            return requested          # ✅ Specific phoneme scoring — ideal path
        else:
            return 'comprehensive'    # ⚠️  No IPA — fall back to word-level

    if requested in _FLUENCY_TESTS:
        return 'comprehensive'        # 🚫 Fluency = always 100% for technique — override

    return requested                  # Pass through ('comprehensive', etc.)


async def score_with_cam(
    audio_bytes: bytes,
    sentence: str,
    test_type: str,
    language: str = 'english',
    cam_sentence_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Proxy audio to the Clario Analysis Module /analyze endpoint.
    Intelligently resolves the test_type so technique practice is scored
    correctly (see _resolve_test_type for the full decision logic).
    """
    targets = _build_targets(sentence)
    effective_test_type = _resolve_test_type(test_type, targets)

    # Always use the sentence text as sentence_id — CTkM's internal DB integer
    # (cam_sentence_id) is unknown to CAM's Firestore bank, and the dynamic-
    # sentence path in pipeline_manager needs the text to build SentenceEntry.text
    # correctly for SequenceMatcher alignment.
    effective_sentence_id = sentence

    targets_json = json.dumps(targets)

    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.post(
            f'{CAM_BASE_URL}/api/v1/analyze',
            data={
                'sentence_id': effective_sentence_id,
                'test_type': effective_test_type,
                'language': language,
                'targets_json': targets_json,
            },
            files={'file': ('audio.wav', audio_bytes, 'audio/wav')},
        )

        if r.status_code != 200:
            return {'success': False, 'score': 0.0, 'error': r.text}

        data = r.json()
        raw_score = float(data.get('accuracy_score', 0.0))

        return {
            'success': True,
            'score': raw_score,
            'accuracy_score': raw_score,
            'transcript': data.get('transcript', ''),
            'word_results': data.get('word_results', []),
            'raw': data,
        }
