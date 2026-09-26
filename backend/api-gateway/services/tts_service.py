import asyncio
import os
import tempfile
import threading
import numpy as np
import librosa
import soundfile as sf
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

from utils.logger import get_logger

try:
    import torch
    from TTS.api import TTS
    COQUI_AVAILABLE = True
except ImportError:
    COQUI_AVAILABLE = False

try:
    import edge_tts
    EDGE_TTS_AVAILABLE = True
except ImportError:
    EDGE_TTS_AVAILABLE = False

logger = get_logger("TTSService")

# Threading lock for shared Coqui model access
_MODEL_LOCK = threading.Lock()

# Voice Mappings for edge-tts fallback
EDGE_VOICES = {
    'en': 'en-US-ChristopherNeural',
    'en-f': 'en-US-AriaNeural',
    'ur': 'ur-PK-UzmaNeural',
    'ur-m': 'ur-PK-AsadNeural'
}

# ============================================================
# Coqui XTTS v2 Configuration (from notebook)
# ============================================================
COQUI_SPEAKER = 'Ana Florence'
COQUI_TTS_PARAMS = {
    'temperature': 0.65,        # Conservative — prevents random artifacts
    'top_k': 150,               # Focused vocabulary
    'top_p': 0.80,              # Less divergence
    'repetition_penalty': 1.5,  # Prevents repeated artifacts
    'speed': 0.95,              # Slightly slower for clearer enunciation
}

# Thread pool for blocking TTS operations
_thread_pool = ThreadPoolExecutor(max_workers=2)


class CoquiTTSService:
    """
    Coqui XTTS v2 TTS Service - Premium quality, pre-loaded at startup.
    Speaker: Ana Florence
    Languages: English (en), Urdu (hi for Hindi mode)
    
    Pre-processing handles:
    - English: Punctuation normalization, hard stops
    - Urdu: Danda (۔) handling, whitespace normalization
    
    Post-processing applies:
    - 250ms artifact trimming
    - -1dB normalization
    - 80Hz high-pass filter
    - 50ms fade in/out
    """
    
    _model = None  # Singleton model instance
    _device = None
    
    @classmethod
    def initialize(cls):
        """Load Coqui XTTS v2 model at startup (blocking)"""
        if not COQUI_AVAILABLE:
            logger.warning("⚠️ Coqui TTS not available - install 'TTS' package")
            return False
        
        try:
            cls._device = 'cuda' if torch.cuda.is_available() else 'cpu'
            logger.info(f"🎤 Loading Coqui XTTS v2 on {cls._device.upper()}...")

            # Accept license non-interactively (required in Docker / non-TTY environments)
            os.environ.setdefault("COQUI_TOS_AGREED", "1")
            cls._model = TTS('tts_models/multilingual/multi-dataset/xtts_v2').to(cls._device)
            logger.info(f"✅ Coqui XTTS v2 loaded - Speaker: {COQUI_SPEAKER}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to load Coqui XTTS v2: {e}")
            return False
    
    @staticmethod
    def _preprocess_english(text: str) -> str:
        """Normalize English text for TTS"""
        text = ' '.join(text.split())  # Collapse whitespace
        text = text.replace('...', '.').replace('..', '.')
        text = text.strip()
        # Hard stop prevents trailing hallucinations
        if text and text[-1] not in '.!?':
            text += '.'
        return text
    
    @staticmethod
    def _preprocess_urdu(text: str) -> str:
        """Normalize Urdu text for TTS (Hindi mode)"""
        text = ' '.join(text.split())  # Collapse whitespace
        text = text.strip('\u06d4!\u061f ')
        # Space after punctuation
        text = text.replace('\u06d4', '\u06d4 ')
        text = text.replace('\u061f', '\u061f ')
        text = ' '.join(text.split())
        # Hard stop (Urdu danda ۔) prevents trailing hallucinations
        if text and text[-1] not in '\u06d4!\u061f':
            text += '\u06d4'
        return text
    
    @staticmethod
    def _remove_artifacts(file_path: str, trim_ms: int = 250) -> bool:
        """Remove leading/trailing silence and artifacts"""
        try:
            y, sr = librosa.load(file_path, sr=None)
            trim_samples = int(sr * trim_ms / 1000)
            threshold = 0.01
            
            # Find start
            start_idx = 0
            for i in range(0, len(y) - trim_samples):
                if np.max(np.abs(y[i:i + trim_samples])) > threshold:
                    start_idx = i
                    break
            
            # Find end
            end_idx = len(y)
            for i in range(len(y) - 1, trim_samples, -1):
                if np.max(np.abs(y[i - trim_samples:i])) > threshold:
                    end_idx = i
                    break
            
            y_trimmed = y[start_idx:end_idx].copy()  # copy — in-place fades must not mutate y
            if len(y_trimmed) > sr * 0.5:  # Keep only if > 500ms
                fade_samples = int(sr * 0.05)  # 50ms
                if fade_samples > 0 and len(y_trimmed) > fade_samples * 2:
                    y_trimmed[:fade_samples] *= np.linspace(0, 1, fade_samples)
                    y_trimmed[-fade_samples:] *= np.linspace(1, 0, fade_samples)
                sf.write(file_path, y_trimmed, sr)
                return True
        except Exception as e:
            logger.warning(f"⚠️ Artifact removal failed: {e}")
        return False
    
    @staticmethod
    def _enhance_audio(file_path: str) -> bool:
        """Normalize, filter, and validate audio"""
        try:
            y, sr = librosa.load(file_path, sr=None)
            peak = np.max(np.abs(y))
            
            # Reject clipped
            if peak > 0.99:
                logger.warning(f"⚠️ Clipping detected ({peak:.2f})")
                return False
            
            # Normalize to -1dB
            if peak > 0:
                target_linear = 10 ** (-1.0 / 20.0)
                y = y * (target_linear / peak)
            
            # 80Hz high-pass filter
            from scipy import signal
            sos = signal.butter(4, 80, 'hp', fs=sr, output='sos')
            y = signal.sosfilt(sos, y)
            
            # Final normalize
            max_val = np.max(np.abs(y))
            if max_val > 0:
                y = y / (max_val * 1.02)
            
            sf.write(file_path, y, sr)
            return True
        except Exception as e:
            logger.warning(f"⚠️ Audio enhancement failed: {e}")
            return False
    
    @classmethod
    def _generate_coqui_sync(cls, text: str, lang: str = "en") -> Optional[bytes]:
        """Synchronous Coqui TTS generation (runs in thread pool)"""
        if not cls._model:
            logger.error("❌ Coqui model not initialized")
            return None
        
        try:
            # Preprocess
            if lang == "hi":  # Urdu
                text = cls._preprocess_urdu(text)
            else:
                text = cls._preprocess_english(text)
            
            # Generate
            fd, temp_path = tempfile.mkstemp(suffix=".wav")
            os.close(fd)

            with _MODEL_LOCK:
                cls._model.tts_to_file(
                    text=text,
                    file_path=temp_path,
                    speaker=COQUI_SPEAKER,
                    language=lang,
                    **COQUI_TTS_PARAMS
                )
            
            # Post-process
            cls._remove_artifacts(temp_path, trim_ms=250)
            cls._enhance_audio(temp_path)
            
            # Read as bytes
            with open(temp_path, 'rb') as f:
                audio_bytes = f.read()
            
            os.remove(temp_path)
            return audio_bytes
            
        except Exception as e:
            logger.error(f"❌ Coqui generation failed: {e}")
            return None
    
    @classmethod
    async def synthesize_coqui(cls, text: str, lang: str = "en") -> Optional[bytes]:
        """
        Generate TTS using Coqui XTTS v2 (async wrapper)
        
        Args:
            text: Text to synthesize
            lang: Language code ("en" for English, "hi" for Urdu)
        
        Returns:
            WAV audio bytes or None on failure
        """
        logger.info(f"🎤 Coqui TTS: {text[:30]}... ({lang})")
        
        # Run blocking operation in thread pool
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _thread_pool,
            cls._generate_coqui_sync,
            text,
            lang
        )


class TTSService:
    """
    Unified TTS Service - Primary Coqui XTTS v2, fallback to edge-tts
    
    Supports:
    - Coqui XTTS v2: Premium quality for sentence banks and dynamic coaching
    - Edge-TTS: Fallback for emergency voice variations (if Coqui unavailable)
    """
    
    @staticmethod
    async def synthesize_to_bytes(
        text: str,
        lang: str = "en",
        gender: str = "m",
        use_coqui: bool = True,
        retries: int = 2,
        rate: str = "+0%",
    ) -> Optional[bytes]:
        """
        Generate TTS audio as bytes.

        Routing:
          - English ("en"): Coqui XTTS v2 (Ana Florence) primary, edge-tts fallback.
          - Urdu   ("ur"): edge-tts primary (ur-PK-UzmaNeural), matching bank_generator.ipynb.
            Coqui is never used for Urdu here — use rate="-30%" for isolated word audio.

        Args:
            text: Text to synthesize
            lang: Language ("en" for English, "ur" for Urdu)
            gender: Gender hint for edge-tts voice selection ("m" or "f")
            use_coqui: Prefer Coqui XTTS v2 when True (ignored for Urdu)
            retries: Number of retry attempts for edge-tts
            rate: Speech rate for edge-tts ("+0%" normal, "-30%" slower for words)

        Returns:
            Audio bytes (WAV for Coqui, MP3 for edge-tts) or None
        """
        if not text:
            return None

        # ── English: Coqui XTTS v2 only on GPU (CPU inference is 15-45s per clip) ──
        if lang == "en" and use_coqui and CoquiTTSService._model and CoquiTTSService._device == "cuda":
            audio = await CoquiTTSService.synthesize_coqui(text, "en")
            if audio:
                return audio
            logger.warning("⚠️ Coqui failed for English — falling back to edge-tts")

        # ── Urdu: edge-tts primary (matches bank_generator.ipynb) ──
        # ── English fallback: edge-tts when Coqui unavailable/failed  ──
        if not EDGE_TTS_AVAILABLE:
            logger.error("❌ No TTS backend available")
            return None

        # For English, default to female voice (AriaNeural) unless male explicitly requested
        if lang == "en" and gender != "m":
            voice_key = "en-f"
        else:
            voice_key = f"{lang}-{gender}" if f"{lang}-{gender}" in EDGE_VOICES else lang
        selected_voice = EDGE_VOICES.get(voice_key, EDGE_VOICES['en-f'])

        engine_label = "edge-tts primary" if lang == "ur" else "edge-tts fallback"
        logger.info(f"🗣️ {engine_label} ({selected_voice}, rate={rate}): '{text[:30]}...'")

        fd, temp_path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)

        for attempt in range(retries):
            try:
                communicate = edge_tts.Communicate(text, selected_voice, rate=rate)
                await communicate.save(temp_path)

                if os.path.exists(temp_path) and os.path.getsize(temp_path) > 0:
                    with open(temp_path, "rb") as f:
                        audio_bytes = f.read()
                    os.remove(temp_path)
                    return audio_bytes
                elif os.path.exists(temp_path):
                    os.remove(temp_path)
            except Exception as e:
                logger.warning(f"⚠️ Edge-TTS attempt {attempt+1} failed: {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(0.5)

        if os.path.exists(temp_path):
            os.remove(temp_path)
        return None