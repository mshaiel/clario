"""
Pre-download all AI models at Docker build time.
This caches the weights as a Docker layer so cold-start model downloads
don't happen in production on first request.
"""
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s - %(message)s")
logger = logging.getLogger("ModelDownloader")

# ─── Wav2Vec2 ─────────────────────────────────────────────────────────────────
WAV2VEC2_MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"

def download_wav2vec2():
    from transformers import Wav2Vec2ForCTC, Wav2Vec2CTCTokenizer, Wav2Vec2FeatureExtractor
    logger.info(f"⬇️  Downloading Wav2Vec2: {WAV2VEC2_MODEL_ID}")
    Wav2Vec2CTCTokenizer.from_pretrained(WAV2VEC2_MODEL_ID)
    Wav2Vec2FeatureExtractor.from_pretrained(WAV2VEC2_MODEL_ID)
    Wav2Vec2ForCTC.from_pretrained(WAV2VEC2_MODEL_ID)
    logger.info("✅ Wav2Vec2 downloaded.")

# ─── Whisper ──────────────────────────────────────────────────────────────────
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "tiny")

def download_whisper():
    from faster_whisper import WhisperModel
    logger.info(f"⬇️  Downloading Whisper model: {WHISPER_MODEL_SIZE}")
    # Instantiating triggers the HuggingFace cache download
    WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    logger.info("✅ Whisper downloaded.")

# ─── Allosaurus ───────────────────────────────────────────────────────────────
def download_allosaurus():
    import subprocess, sys
    logger.info("⬇️  Downloading Allosaurus 'latest' model via CLI...")
    # allosaurus.am.pretrained does not exist in v1.0.2.
    # The only reliable download API is the bundled CLI module.
    subprocess.run(
        [sys.executable, "-m", "allosaurus.bin.download_model", "-m", "latest"],
        check=True,
    )
    logger.info("✅ Allosaurus downloaded.")


if __name__ == "__main__":
    errors = []

    for name, fn in [
        ("Wav2Vec2", download_wav2vec2),
        ("Whisper", download_whisper),
        ("Allosaurus", download_allosaurus),
    ]:
        try:
            fn()
        except Exception as e:
            logger.error(f"❌ Failed to download {name}: {e}")
            errors.append(name)

    if errors:
        logger.error(f"❌ Model download failed for: {errors}")
        exit(1)

    logger.info("🎉 All models downloaded successfully.")
