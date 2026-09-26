"""
Shared ASR Data Structures
---------------------------
Common data classes used across fluency and phonology detectors.
"""

from dataclasses import dataclass
from typing import List

@dataclass
class Word:
    """Represents a word from ASR transcription"""
    word: str
    start: float
    end: float
    confidence: float = 1.0

@dataclass
class Phone:
    """Represents a phoneme from ASR recognition"""
    phone: str
    start: float
    end: float
    duration: float

@dataclass
class ASRResult:
    """Container for ASR output"""
    words: List[Word]
    phones: List[Phone]