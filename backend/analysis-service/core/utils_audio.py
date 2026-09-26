import os
import tempfile
import logging
from typing import Tuple, Optional
from fastapi import UploadFile

import numpy as np
from core.config import GLOBAL_CONFIG

logger = logging.getLogger(__name__)

# ─── AUDIO VALIDATION ─────────────────────────────────────────

def validate_audio_file(file_path: str) -> bool:
    """Check if the audio file exists and is processable."""
    config = GLOBAL_CONFIG.audio
    
    if not os.path.exists(file_path):
        logger.error(f"Audio file does not exist: {file_path}")
        return False
    
    _, ext = os.path.splitext(file_path)
    if ext.lower() not in config.supported_formats:
        logger.warning(f"Unusual audio format '{ext}', will attempt to process: {file_path}")
    
    try:
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        if file_size_mb > 100:
            logger.error(f"Audio file too large ({file_size_mb:.2f} MB): {file_path}")
            return False
        if file_size_mb == 0:
            logger.error(f"Audio file is empty: {file_path}")
            return False
    except Exception as e:
        logger.error(f"Failed to check file size: {e}")
        return False
    
    return True

# ─── AUDIO LOADING & RESAMPLING (OPTIMIZED) ───────────────────────

def load_audio(file_path: str, target_sr: int = None, mono: bool = True) -> Tuple[np.ndarray, int]:
    """
    ⭐ OPTIMIZED: WAV-first strategy, skip unnecessary fallbacks
    
    Args:
        file_path: Path to audio file
        target_sr: Target sample rate (default from config)
        mono: Convert to mono if True
    
    Returns:
        waveform: np.ndarray, shape (n_samples,)
        sample_rate: int
    """
    if target_sr is None:
        target_sr = GLOBAL_CONFIG.audio.sample_rate
    
    logger.info(f"🔄 Loading audio: {file_path}")
    
    # ⭐ OPTIMIZATION 1: Check file extension first
    ext = os.path.splitext(file_path)[1].lower()
    
    # ⭐ OPTIMIZATION 2: WAV files - use soundfile ONLY (99% of mobile uploads)
    if ext in ['.wav', '.wave']:
        try:
            import soundfile as sf
            waveform, sr = sf.read(file_path, always_2d=False)
            logger.info(f"✅ Loaded WAV with soundfile - shape: {waveform.shape}, sr: {sr}")
            
            if waveform.ndim > 1 and mono:
                waveform = np.mean(waveform, axis=1)
            
            # ⭐ OPTIMIZATION 3: Skip resampling if already correct SR
            if sr != target_sr:
                import librosa
                waveform = librosa.resample(waveform, orig_sr=sr, target_sr=target_sr)
                sr = target_sr
                logger.info(f"🔧 Resampled to {target_sr}Hz")
            else:
                logger.info(f"✅ Sample rate already {target_sr}Hz, skipping resample")
            
            return waveform.astype(np.float32), sr
            
        except Exception as e:
            logger.warning(f"❌ soundfile failed on WAV: {e}")

    # ⭐ OPTIMIZATION 4: Non-WAV files - try librosa first (handles most formats)
    try:
        import librosa
        waveform, sr = librosa.load(file_path, sr=target_sr, mono=mono)
        logger.info(f"✅ Loaded with librosa - shape: {waveform.shape}, sr: {sr}")
        return waveform.astype(np.float32), sr
        
    except Exception as e:
        logger.warning(f"❌ librosa failed: {e}")

    # ⭐ OPTIMIZATION 5: Only try pydub for known mobile formats
    if ext in ['.mp3', '.m4a', '.aac', '.3gp', '.ogg']:
        try:
            from pydub import AudioSegment
            audio = AudioSegment.from_file(file_path)
            
            if audio.channels > 1 and mono:
                audio = audio.set_channels(1)
            if audio.frame_rate != target_sr:
                audio = audio.set_frame_rate(target_sr)
            
            samples = np.array(audio.get_array_of_samples())
            
            if audio.sample_width == 2:
                waveform = samples.astype(np.float32) / 32768.0
            elif audio.sample_width == 1:
                waveform = samples.astype(np.float32) / 255.0
            else:
                waveform = samples.astype(np.float32) / (2 ** (8 * audio.sample_width - 1))
            
            sr = target_sr
            logger.info(f"✅ Loaded with pydub - shape: {waveform.shape}, sr: {sr}")
            return waveform, sr
            
        except Exception as e:
            logger.warning(f"❌ pydub failed: {e}")

    # All methods failed
    error_msg = f"Failed to load audio {file_path}: All methods exhausted"
    logger.error(error_msg)
    raise ValueError(error_msg)

# ─── AUDIO NORMALIZATION (NO TRIMMING) ───────────────────────────

def normalize_audio(audio: np.ndarray, peak: float = 0.99) -> np.ndarray:
    """
    Normalize audio waveform amplitude to specified peak.
    DOES NOT trim silence - required for fluency detection.
    """
    max_amp = np.max(np.abs(audio))
    if max_amp == 0:
        logger.warning("Audio has zero amplitude, skipping normalization")
        return audio
    normalized = audio * (peak / max_amp)
    logger.info(f"🔧 Normalized audio: max_amp {max_amp:.3f} -> {peak}")
    return normalized

# ─── TEMPORARY FILE MANAGEMENT ───────────────────────────────────

async def save_upload_to_temp(upload_file: UploadFile, suffix: str = ".wav") -> str:
    """
    Saves an uploaded file to a temporary location.
    Uses async read to avoid blocking the event loop.

    Args:
        upload_file: FastAPI UploadFile object
        suffix: File extension (e.g., ".wav", ".mp3")

    Returns:
        Path to the temporary file
    """
    config = GLOBAL_CONFIG.audio

    fd, temp_path = tempfile.mkstemp(
        suffix=suffix,
        prefix=config.temp_file_prefix
    )

    try:
        content = await upload_file.read()
        with os.fdopen(fd, 'wb') as tmp:
            tmp.write(content)

        logger.info(f"📁 Saved upload to temp: {temp_path} ({len(content)} bytes)")
        return temp_path
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        logger.error(f"Failed to save upload: {e}")
        raise

def create_temp_audio_file(suffix: str = ".wav") -> str:
    """Create a temporary audio file path with consistent prefix."""
    config = GLOBAL_CONFIG.audio
    temp_dir = tempfile.gettempdir()
    fd, path = tempfile.mkstemp(
        suffix=suffix, 
        prefix=config.temp_file_prefix, 
        dir=temp_dir
    )
    os.close(fd)
    return path

def save_audio_file(audio: np.ndarray, file_path: str, sr: int = None) -> None:
    """Save audio waveform to file in WAV format."""
    if sr is None:
        sr = GLOBAL_CONFIG.audio.sample_rate
    
    try:
        import soundfile as sf
        sf.write(file_path, audio, sr, format='WAV', subtype='PCM_16')
        logger.info(f"💾 Saved audio: {file_path} ({len(audio)} samples)")
    except Exception as e:
        logger.error(f"Failed to save audio to {file_path}: {e}")
        raise

def cleanup_temp_file(file_path: str) -> None:
    """Remove temporary file safely."""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
            logger.info(f"🧹 Cleaned up temp file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to delete temp file {file_path}: {e}")

# ─── HIGH-LEVEL AUDIO PREPROCESSING ──────────────────────────────

def preprocess_audio(file_path: str, target_sr: int = None, mono: bool = True,
                     normalize: bool = True) -> str:
    """
    Full audio preprocessing pipeline.
    IMPORTANT: Does NOT trim silences - required for fluency block detection.
    """
    if target_sr is None:
        target_sr = GLOBAL_CONFIG.audio.sample_rate
    
    logger.info(f"🎵 Starting audio preprocessing: {file_path}")
    
    if not validate_audio_file(file_path):
        raise ValueError(f"Invalid audio file: {file_path}")
    
    audio, sr = load_audio(file_path, target_sr=target_sr, mono=mono)
    
    if normalize:
        audio = normalize_audio(audio)
    
    processed_path = create_temp_audio_file(suffix='_processed.wav')
    save_audio_file(audio, processed_path, sr)
    
    logger.info(f"✅ Audio preprocessing complete: {processed_path}")
    return processed_path

# ─── DEBUG UTILITIES ─────────────────────────────────────────

def debug_audio_file(file_path: str):
    """Debug function to inspect audio file properties."""
    logger.info(f"🔍 Debugging audio file: {file_path}")
    
    size = os.path.getsize(file_path)
    logger.info(f"📁 File size: {size} bytes ({size / 1024:.2f} KB)")
    
    try:
        with open(file_path, 'rb') as f:
            header = f.read(12)
            logger.info(f"🔬 File header (hex): {header.hex()}")
            
            if header.startswith(b'RIFF'):
                logger.info("🎵 Detected: WAV file")
            elif header.startswith(b'\xff\xfb') or header.startswith(b'ID3'):
                logger.info("🎵 Detected: MP3 file")
            elif header[4:8] == b'ftyp':
                logger.info("🎵 Detected: MP4/M4A file")
            elif header.startswith(b'OggS'):
                logger.info("🎵 Detected: OGG file")
            elif header.startswith(b'fLaC'):
                logger.info("🎵 Detected: FLAC file")
            else:
                logger.info("🎵 Detected: Unknown format")
    except Exception as e:
        logger.error(f"❌ Could not read file header: {e}")
    
    try:
        audio, sr = load_audio(file_path)
        duration = len(audio) / sr
        logger.info(f"📊 Audio properties:")
        logger.info(f"   - Sample rate: {sr} Hz")
        logger.info(f"   - Duration: {duration:.2f} seconds")
        logger.info(f"   - Samples: {len(audio)}")
        logger.info(f"   - Max amplitude: {np.max(np.abs(audio)):.3f}")
        logger.info(f"   - RMS level: {np.sqrt(np.mean(audio**2)):.3f}")
    except Exception as e:
        logger.error(f"❌ Could not analyze audio properties: {e}")