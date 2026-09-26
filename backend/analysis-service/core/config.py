import os
from dataclasses import dataclass, field
from typing import List, Dict


@dataclass
class ASRConfig:
    """ASR Model Settings — all overridable via environment variables."""

    # Whisper model size: "tiny", "base", "small", "medium", "large-v3"
    model_size: str = os.getenv("WHISPER_MODEL_SIZE", "tiny")
    compute_type: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
    device: str = os.getenv("WHISPER_DEVICE", "cpu")
    beam_size: int = int(os.getenv("WHISPER_BEAM_SIZE", "3"))
    beam_size_phonology: int = int(os.getenv("WHISPER_BEAM_SIZE_PHONOLOGY", "5"))

    # Point to a local model cache directory to skip HuggingFace download
    whisper_path: str = os.getenv("WHISPER_MODEL_PATH", None)

    # Language Mappings (API Input -> Whisper internal code)
    lang_map: Dict[str, str] = field(default_factory=lambda: {
        "english": "en",
        "urdu": "ur",
    })

    # Allosaurus Mappings (API Input -> Allosaurus internal code)
    allosaurus_map: Dict[str, str] = field(default_factory=lambda: {
        "english": "eng",
        "urdu": "urd",
    })

    wav2vec2_model_id: str = os.getenv(
        "WAV2VEC2_MODEL_ID",
        "facebook/wav2vec2-lv-60-espeak-cv-ft",
    )


@dataclass
class AudioConfig:
    """Audio Processing Settings"""
    sample_rate: int = int(os.getenv("AUDIO_SAMPLE_RATE", "16000"))
    temp_file_prefix: str = "clario_"
    supported_formats: List[str] = field(default_factory=lambda: [
        ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".webm",
    ])


@dataclass
class Thresholds:
    """Detection Sensitivities"""
    vad_aggressiveness: int = 3
    vad_frame_ms: int = 20
    min_block_ms: int = 350
    min_prolongation_ms: float = 0.15
    repetition_max_gap_ms: int = 500
    min_confidence: float = 0.4


@dataclass
class PipelineConfig:
    """Master Configuration"""
    asr: ASRConfig = field(default_factory=ASRConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    thresholds: Thresholds = field(default_factory=Thresholds)


GLOBAL_CONFIG = PipelineConfig()
