"""
Fix static_tts manifest.json on HuggingFace:
  1. Replace placeholder text with real speech-therapy assistant lines
  2. Fix intro file fields (intro_NNN_type.wav -> intro_type.wav)
  3. Generate TTS audio for missing resume + epenthesis files
  4. Upload new audio to HF
  5. Upload updated manifest
"""
import asyncio
import json
import os
import tempfile
import urllib.request

import edge_tts
from huggingface_hub import HfApi

HF_TOKEN = os.getenv("HF_TOKEN", "")
REPO_ID  = "junaiddbz/TTS_Audios"
VOICE    = "en-US-AriaNeural"
HF_BASE  = "sentence_banks"  # unused here, but for reference
MANIFEST_HF_PATH = "static_tts/manifest.json"
AUDIO_HF_PREFIX  = "static_tts/english"

# ── Real text for every line ──────────────────────────────────────────────────

INTRO_TEXT = {
    "intro_comprehensive":     "Let's begin your comprehensive speech assessment. I'll ask you to read some sentences out loud. Take your time and speak naturally.",
    "intro_velar_fronting":    "Time for your velar sounds assessment. You'll read sentences with K and G sounds. Speak each one clearly.",
    "intro_blocks":            "Starting your fluency blocks assessment. Speak at a comfortable pace — stuttering is what we're here to measure, so just keep going.",
    "intro_repetition":        "This is your repetition assessment. Read each sentence aloud, even if you notice repeated sounds or words.",
    "intro_prolongation":      "Starting your prolongation assessment. Read naturally. If you stretch out sounds, that's okay — just continue.",
    "intro_gliding":           "Let's check your R and W sounds. Read each sentence clearly and take your time.",
    "intro_stopping":          "Starting your stopping sounds assessment. Focus on the final sounds in each word as you read aloud.",
    "intro_cluster_reduction": "This is your consonant cluster assessment. Some sentences have tricky sound combinations — just do your best.",
    "intro_epenthesis":        "Starting your epenthesis assessment. Some sentences contain consonant clusters. Read each one as naturally as you can.",
}

RESUME_TEXT = {
    "resume_comprehensive":     "Welcome back! Let's continue your comprehensive speech assessment. Ready to pick up where we left off?",
    "resume_velar_fronting":    "Resuming the velar sounds assessment. A few more K and G sentences to go.",
    "resume_blocks":            "Resuming your fluency blocks assessment. Just a few more sentences remaining.",
    "resume_repetition":        "Back to the repetition assessment. Ready to continue?",
    "resume_prolongation":      "Continuing the prolongation assessment. Almost there — just a few more sentences.",
    "resume_gliding":           "Resuming the R and W sounds assessment. You're making good progress.",
    "resume_stopping":          "Back to the stopping sounds assessment. Just a few more to go.",
    "resume_cluster_reduction": "Resuming your consonant cluster assessment. Ready for the next set?",
    "resume_epenthesis":        "Resuming your epenthesis assessment. Let's keep going with the remaining sentences.",
}

WAITING_TEXT = {
    "waiting_001": "Take your time.",
    "waiting_002": "Whenever you're ready.",
    "waiting_003": "No rush, just speak when you're comfortable.",
    "waiting_004": "I'm listening.",
    "waiting_005": "Go ahead when you're ready.",
    "waiting_006": "Take a breath and speak when you're set.",
    "waiting_007": "In your own time.",
    "waiting_008": "Ready when you are.",
    "waiting_009": "Take a moment if you need it.",
    "waiting_010": "There's no hurry.",
    "waiting_011": "Whenever you feel ready, go ahead.",
    "waiting_012": "I'm here, take your time.",
    "waiting_013": "Speak when you're comfortable.",
    "waiting_014": "Go at your own pace.",
    "waiting_015": "Just let me know when you're ready.",
    "waiting_016": "Take your time with this one.",
    "waiting_017": "I'm listening, whenever you're ready.",
    "waiting_018": "No pressure, speak when you're set.",
    "waiting_019": "Take a moment to read it, then go ahead.",
    "waiting_020": "There's no time limit, speak naturally.",
}

VALIDATION_PERF_TEXT = {
    "val_perf_001": "Excellent! That was perfect.",
    "val_perf_002": "Great job! No errors detected.",
    "val_perf_003": "Well done! That was spot on.",
    "val_perf_004": "Perfect! Keep it up.",
    "val_perf_005": "Wonderful! That sounded great.",
    "val_perf_006": "Fantastic work! No issues there.",
    "val_perf_007": "That was excellent — nice and clear.",
    "val_perf_008": "Perfect score! Moving on.",
    "val_perf_009": "Brilliant! Every sound was clear.",
    "val_perf_010": "Outstanding! That was flawless.",
    "val_perf_011": "Great! You nailed that one.",
    "val_perf_012": "Perfect! Your articulation was clear.",
    "val_perf_013": "Well done! That was spot on.",
    "val_perf_014": "Excellent! I noticed no errors.",
    "val_perf_015": "Fantastic! You said that clearly.",
    "val_perf_016": "Perfect! Keep going.",
    "val_perf_017": "Great job! That was flawless.",
    "val_perf_018": "Wonderful! No errors at all.",
    "val_perf_019": "Excellent work! That was really clear.",
    "val_perf_020": "Perfect! Well done.",
}

VALIDATION_ERR_TEXT = {
    "val_err_001": "Good try. I noticed one small error. Let's keep going.",
    "val_err_002": "Almost there. There was one sound to work on. Next sentence.",
    "val_err_003": "Good effort. One error noted. Let's continue.",
    "val_err_004": "Nice try. I caught one issue there. Moving on.",
    "val_err_005": "Close! Just one sound to focus on. Keep going.",
    "val_err_006": "Good attempt. One small slip noted. Next one.",
    "val_err_007": "Nearly there. One error to review. Let's continue.",
    "val_err_008": "Not bad. One sound tripped you up. Keep going.",
    "val_err_009": "Good effort. I noted one error. Moving on to the next.",
    "val_err_010": "Almost perfect. One thing to improve. Let's keep going.",
    "val_err_011": "Good try. One small sound to practice. Next sentence.",
    "val_err_012": "Close! Just one minor error. Continuing.",
    "val_err_013": "Nice effort. One correction noted. Moving on.",
    "val_err_014": "Good attempt. One sound to work on. Let's continue.",
    "val_err_015": "Nearly perfect. One error logged. Keep going.",
    "val_err_016": "Good job overall. One small slip. Next one.",
    "val_err_017": "Almost there. One sound to revisit later. Continuing.",
    "val_err_018": "Nice try. One error noted. Moving on.",
    "val_err_019": "Good effort. Almost perfect, one to improve. Next sentence.",
    "val_err_020": "Close! One thing to work on. Let's continue.",
}

VALIDATION_MERR_TEXT = {
    "val_merr_001": "Good try. A few sounds to work on. Let's keep going.",
    "val_merr_002": "Nice effort. Some errors noted. Let's continue.",
    "val_merr_003": "Keep it up. A couple of things to practice. Moving on.",
    "val_merr_004": "Good attempt. Several sounds to review. Next sentence.",
    "val_merr_005": "You're doing well. Some improvements to make. Let's keep going.",
    "val_merr_006": "Good try. A few errors logged. Next one.",
    "val_merr_007": "Nice effort. Some sounds to work on. Continuing.",
    "val_merr_008": "Keep trying. A few things to focus on. Moving on.",
    "val_merr_009": "Good attempt. Multiple sounds to review. Let's continue.",
    "val_merr_010": "You're doing great. Some errors to work through. Next sentence.",
    "val_merr_011": "Good try. Several things noted. Keep going.",
    "val_merr_012": "Nice effort. A few areas to target. Moving on.",
    "val_merr_013": "Keep at it. Some errors logged. Next one.",
    "val_merr_014": "Good attempt. Multiple improvements noted. Let's continue.",
    "val_merr_015": "You're trying hard. A few sounds to practice. Moving on.",
    "val_merr_016": "Good effort. Several areas to work on. Continuing.",
    "val_merr_017": "Keep going. A few errors noted. Next sentence.",
    "val_merr_018": "Nice try. Some sounds to revisit. Moving on.",
    "val_merr_019": "Good attempt. Multiple things to work on. Let's continue.",
    "val_merr_020": "Keep it up. Several errors noted. Next one.",
}

TRANSITION_TEXT = {
    f"trans_{i:03d}": t for i, t in enumerate([
        "Moving on to the next sentence.",
        "Next one.",
        "Let's try another.",
        "Here comes the next sentence.",
        "Moving forward.",
        "On to the next.",
        "Let's continue.",
        "Here's the next one for you.",
        "Next sentence.",
        "Let's keep going.",
        "Moving to the next exercise.",
        "Here we go — next sentence.",
        "Alright, let's try this one.",
        "Next up.",
        "Let's move on.",
        "Ready for the next one?",
        "Coming up next.",
        "Here's another sentence for you.",
        "Let's try the next one.",
        "Moving on.",
        "Here comes another.",
        "Next sentence coming up.",
        "Let's go to the next one.",
        "Alright, moving forward.",
        "Here's the next sentence.",
        "Let's continue with the next one.",
        "Next exercise.",
        "Alright, next one.",
        "Moving along.",
        "Here we go.",
    ], start=1)
}

COMPLETION_TEXT = {
    "comp_001": "Assessment complete! Great work today. Your results have been recorded.",
    "comp_002": "You've finished the assessment! Well done. Your responses have been saved.",
    "comp_003": "That's all the sentences! Excellent effort today. Assessment recorded.",
    "comp_004": "Assessment done! You did a fantastic job. Thank you for your effort.",
    "comp_005": "All finished! You've completed the assessment. Great work today.",
}

ALL_TEXT = {
    **INTRO_TEXT, **RESUME_TEXT, **WAITING_TEXT,
    **VALIDATION_PERF_TEXT, **VALIDATION_ERR_TEXT, **VALIDATION_MERR_TEXT,
    **TRANSITION_TEXT, **COMPLETION_TEXT,
}

# Intro ID → file mapping (actual filenames on HF)
INTRO_FILE_MAP = {
    "intro_001_comprehensive":     "intro_comprehensive.wav",
    "intro_002_velar_fronting":    "intro_velar_fronting.wav",
    "intro_003_blocks":            "intro_blocks.wav",
    "intro_004_repetition":        "intro_repetition.wav",
    "intro_005_prolongation":      "intro_prolongation.wav",
    "intro_006_gliding":           "intro_gliding.wav",
    "intro_007_stopping":          "intro_stopping.wav",
    "intro_008_cluster_reduction": "intro_cluster_reduction.wav",
}

# Resume items to generate (don't exist on HF)
RESUME_GENERATE = [
    ("resume_001_comprehensive",     "resume_comprehensive"),
    ("resume_002_velar_fronting",    "resume_velar_fronting"),
    ("resume_003_blocks",            "resume_blocks"),
    ("resume_004_repetition",        "resume_repetition"),
    ("resume_005_prolongation",      "resume_prolongation"),
    ("resume_006_gliding",           "resume_gliding"),
    ("resume_007_stopping",          "resume_stopping"),
    ("resume_008_cluster_reduction", "resume_cluster_reduction"),
]

# Epenthesis: needs new manifest entry + audio
EPENTHESIS_INTRO_ID   = "intro_009_epenthesis"
EPENTHESIS_INTRO_FILE = "intro_epenthesis.wav"
EPENTHESIS_INTRO_TEXT_KEY = "intro_epenthesis"

EPENTHESIS_RESUME_ID   = "resume_009_epenthesis"
EPENTHESIS_RESUME_FILE = "resume_epenthesis.wav"
EPENTHESIS_RESUME_TEXT_KEY = "resume_epenthesis"


async def generate_wav(text: str, dest_path: str):
    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(dest_path)


async def main():
    api = HfApi(token=HF_TOKEN)

    # ── 1. Load current manifest ──────────────────────────────────────────────
    print("Fetching manifest from HF...")
    url = "https://huggingface.co/datasets/junaiddbz/TTS_Audios/resolve/main/static_tts/manifest.json"
    with urllib.request.urlopen(url, timeout=15) as r:
        manifest = json.loads(r.read())

    eng = manifest["english"]

    # ── 2. Fix intro file fields + text ──────────────────────────────────────
    print("Fixing intro file fields and text...")
    for item in eng.get("intro", []):
        item_id = item["id"]
        # Fix file field
        if item_id in INTRO_FILE_MAP:
            item["file"] = INTRO_FILE_MAP[item_id]
        # Fix text — derive key from file name (strip .wav)
        text_key = item["file"].replace(".wav", "")
        item["text"] = ALL_TEXT.get(text_key, item["text"])

    # ── 3. Fix resume text + generate+upload missing audio ───────────────────
    with tempfile.TemporaryDirectory() as tmpdir:

        print("Generating resume audio files...")
        for manifest_id, text_key in RESUME_GENERATE:
            wav_file = os.path.join(tmpdir, f"{text_key}.wav")
            text = RESUME_TEXT[text_key]
            print(f"  TTS: {text_key}")
            await generate_wav(text, wav_file)
            hf_path = f"static_tts/english/{text_key}.wav"
            api.upload_file(
                path_or_fileobj=wav_file,
                path_in_repo=hf_path,
                repo_id=REPO_ID,
                repo_type="dataset",
            )
            print(f"  Uploaded: {hf_path}")

        # Fix resume manifest entries
        for item in eng.get("resume", []):
            item_id = item["id"]
            # Fix file field: resume_001_comprehensive → resume_comprehensive.wav
            parts = item_id.split("_", 2)  # ["resume", "001", "comprehensive"] or similar
            # Drop numeric part: resume_NNN_type → resume_type
            if len(parts) == 3 and parts[1].isdigit():
                new_file = f"resume_{parts[2]}.wav"
            else:
                new_file = f"{item_id}.wav"
            item["file"] = new_file
            text_key = new_file.replace(".wav", "")
            item["text"] = RESUME_TEXT.get(text_key, item["text"])

        # ── 4. Add epenthesis intro + resume entries ──────────────────────────
        epenthesis_present_intro  = any(i["id"] == EPENTHESIS_INTRO_ID  for i in eng.get("intro", []))
        epenthesis_present_resume = any(i["id"] == EPENTHESIS_RESUME_ID for i in eng.get("resume", []))

        if not epenthesis_present_intro:
            print("Generating epenthesis intro audio...")
            wav_file = os.path.join(tmpdir, EPENTHESIS_INTRO_FILE)
            await generate_wav(INTRO_TEXT[EPENTHESIS_INTRO_TEXT_KEY], wav_file)
            api.upload_file(
                path_or_fileobj=wav_file,
                path_in_repo=f"static_tts/english/{EPENTHESIS_INTRO_FILE}",
                repo_id=REPO_ID, repo_type="dataset",
            )
            eng["intro"].append({
                "id": EPENTHESIS_INTRO_ID,
                "file": EPENTHESIS_INTRO_FILE,
                "text": INTRO_TEXT[EPENTHESIS_INTRO_TEXT_KEY],
            })
            print(f"  Added epenthesis intro entry")

        if not epenthesis_present_resume:
            print("Generating epenthesis resume audio...")
            wav_file = os.path.join(tmpdir, EPENTHESIS_RESUME_FILE)
            await generate_wav(RESUME_TEXT[EPENTHESIS_RESUME_TEXT_KEY], wav_file)
            api.upload_file(
                path_or_fileobj=wav_file,
                path_in_repo=f"static_tts/english/{EPENTHESIS_RESUME_FILE}",
                repo_id=REPO_ID, repo_type="dataset",
            )
            eng["resume"].append({
                "id": EPENTHESIS_RESUME_ID,
                "file": EPENTHESIS_RESUME_FILE,
                "text": RESUME_TEXT[EPENTHESIS_RESUME_TEXT_KEY],
            })
            print(f"  Added epenthesis resume entry")

    # ── 5. Fix text for all other categories ─────────────────────────────────
    print("Updating text fields for all other categories...")
    for item in eng.get("waiting", []):
        item["text"] = WAITING_TEXT.get(item["id"], item["text"])

    for item in eng.get("transition", []):
        item["text"] = TRANSITION_TEXT.get(item["id"], item["text"])

    for item in eng.get("completion", []):
        item["text"] = COMPLETION_TEXT.get(item["id"], item["text"])

    val = eng.get("validation", {})
    for item in val.get("perf", []):
        item["text"] = VALIDATION_PERF_TEXT.get(item["id"], item["text"])
    for item in val.get("err", []):
        item["text"] = VALIDATION_ERR_TEXT.get(item["id"], item["text"])
    for item in val.get("merr", []):
        item["text"] = VALIDATION_MERR_TEXT.get(item["id"], item["text"])

    # ── 6. Upload updated manifest ────────────────────────────────────────────
    print("Uploading updated manifest...")
    manifest_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp:
        tmp.write(manifest_bytes)
        tmp_path = tmp.name
    try:
        api.upload_file(
            path_or_fileobj=tmp_path,
            path_in_repo=MANIFEST_HF_PATH,
            repo_id=REPO_ID,
            repo_type="dataset",
        )
        print("Manifest uploaded successfully.")
    finally:
        os.unlink(tmp_path)

    print("Done!")


if __name__ == "__main__":
    asyncio.run(main())
