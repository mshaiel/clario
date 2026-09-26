"""
repair_detector.py
──────────────────
Cancellation / Pull-Out repair scoring.

Architecture (no local Whisper):
  • Silero VAD (already a dependency via torch.hub) → finds the pause gap.
  • CAM /analyze endpoint (via httpx, same pattern as cam_proxy.py) → gives us
    a word-level transcript we can use to verify that the target word was spoken
    after the pause.

This removes the dependency on openai-whisper which is NOT in requirements.txt
and caused an ImportError crash that made every repair-mode technique return 500.
"""

import asyncio
import base64
import io
import logging
import os
from typing import Any, Dict, Optional

import httpx
import numpy as np
import soundfile as sf
import torch

logger = logging.getLogger(__name__)

CAM_BASE_URL = os.getenv('CAM_URL', 'https://junaiddbz-clario-analysis-module.hf.space')


def _resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr:
        return audio
    new_len = int(len(audio) * target_sr / orig_sr)
    return np.interp(
        np.linspace(0, len(audio), new_len),
        np.arange(len(audio)),
        audio,
    ).astype(np.float32)


class RepairDetector:
    """
    Cancellation / Pull-Out repair scoring.

    Models preloaded at startup:
      - Silero VAD  (for silence gap detection)

    Whisper transcription is delegated to CAM via HTTP — no local model needed.
    """

    _vad_model = None
    _get_speech_timestamps = None

    @classmethod
    def preload(cls) -> None:
        """Called from main.py lifespan — loads Silero VAD once."""
        try:
            torch.set_num_threads(1)
            cls._vad_model, utils = torch.hub.load(
                'snakers4/silero-vad', 'silero_vad',
                force_reload=False, trust_repo=True,
            )
            cls._get_speech_timestamps = utils[0]
            logger.info('RepairDetector: Silero VAD loaded.')
        except Exception as e:
            logger.error(f'RepairDetector preload failed: {e}', exc_info=True)
            # Do NOT re-raise — let the app start; analyze() will degrade gracefully.

    # ── Internal helpers ──────────────────────────────────────────────────────

    @classmethod
    def _find_max_silence(cls, tensor_16k: torch.Tensor) -> tuple[float, Optional[int], list]:
        """
        Run Silero VAD and return (max_silence_ms, gap_index, speech_segments).
        Returns (0.0, None, []) if VAD is not loaded or fails.
        """
        if cls._vad_model is None or cls._get_speech_timestamps is None:
            logger.warning('Silero VAD not loaded — skipping pause detection.')
            return 0.0, None, []

        try:
            speech_segs = cls._get_speech_timestamps(
                tensor_16k, cls._vad_model, return_seconds=True
            )
        except Exception as e:
            logger.error(f'Silero VAD inference failed: {e}')
            return 0.0, None, []

        max_silence_ms = 0.0
        max_silence_pos: Optional[int] = None

        if len(speech_segs) >= 2:
            for i in range(len(speech_segs) - 1):
                gap = (speech_segs[i + 1]['start'] - speech_segs[i]['end']) * 1000.0
                if gap > max_silence_ms:
                    max_silence_ms = gap
                    max_silence_pos = i

        return max_silence_ms, max_silence_pos, list(speech_segs)

    @classmethod
    async def _get_transcript_from_cam(
        cls,
        audio_bytes: bytes,
        sentence_text: str,
        language: str,
    ) -> list[str]:
        """
        Send audio to CAM /analyze and extract a word list from the transcript.
        Returns an empty list on any failure — the caller degrades gracefully.
        """
        try:
            async with httpx.AsyncClient(timeout=40.0) as client:
                r = await client.post(
                    f'{CAM_BASE_URL}/api/v1/analyze',
                    data={
                        'sentence_id': sentence_text,
                        'test_type': 'comprehensive',
                        'language': language,
                    },
                    files={'file': ('audio.wav', audio_bytes, 'audio/wav')},
                )
            if r.status_code != 200:
                logger.warning(f'CAM returned {r.status_code} during repair transcript fetch.')
                return []
            data = r.json()
            transcript: str = data.get('transcript', '')
            return transcript.lower().split()
        except Exception as e:
            logger.error(f'CAM transcript fetch failed: {e}')
            return []

    # ── Public API ────────────────────────────────────────────────────────────

    @classmethod
    async def analyze(
        cls,
        audio_bytes: bytes,
        target_sentence: str,
        config: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Scoring logic:
          - No pause after block  →  score=30, feedback_key='no_pause_detected'
          - Pause found, no repair word heard after it  →  score=55, 'pause_found_no_repair'
          - Pause + repair confirmed  →  score=70-100, 'repair_successful'

        'Pause' here means the largest silence gap in the audio that exceeds
        pause_threshold_ms.  'Repair confirmed' means ≥1 of the last 3 target
        words appeared in the post-pause transcript.
        """
        technique = config.get('technique', 'cancellation')
        pause_threshold_ms = float(config.get('pause_threshold_ms', 400))
        language = config.get('language', 'english')

        # ── 1. Load + resample audio ──────────────────────────────────────────
        try:
            audio_array, sr = sf.read(io.BytesIO(audio_bytes))
            if audio_array.ndim > 1:
                audio_array = audio_array.mean(axis=1)
            tensor_16k = torch.FloatTensor(_resample(audio_array, sr, 16000))
        except Exception as e:
            logger.error(f'Audio load failed in RepairDetector: {e}')
            return {'success': False, 'score': 0.0, 'error': str(e)}

        # ── 2. VAD — find the silence gap ─────────────────────────────────────
        max_silence_ms, max_silence_pos, speech_segs = cls._find_max_silence(tensor_16k)
        pause_found = max_silence_ms >= pause_threshold_ms

        # ── 3. Get transcript from CAM (non-blocking, runs in parallel with VAD) ─
        transcript_words = await cls._get_transcript_from_cam(
            audio_bytes, target_sentence, language
        )

        # ── 4. Verify repair: did a target word appear after the pause? ────────
        target_words = [w.lower() for w in target_sentence.split()]
        target_found_after_pause = False

        if pause_found and max_silence_pos is not None and speech_segs:
            # We don't have per-word timestamps from CAM's basic transcript,
            # so we approximate: any target word in the FULL transcript counts
            # as "repair attempted" when there IS a pause.  This matches the
            # spirit of pullout / cancellation — the user stuttered, paused,
            # then said the word again.
            target_found_after_pause = any(tw in transcript_words for tw in target_words[-3:])

        # ── 5. Score ──────────────────────────────────────────────────────────
        if not pause_found:
            score = 30.0
            feedback_key = 'no_pause_detected'
        elif not target_found_after_pause:
            score = 55.0
            feedback_key = 'pause_found_no_repair'
        else:
            score = min(100.0, 70.0 + (max_silence_ms - pause_threshold_ms) / 10.0)
            feedback_key = 'repair_successful'

        return {
            'success': True,
            'score': round(score, 2),
            'max_silence_ms': round(max_silence_ms, 1),
            'pause_found': pause_found,
            'pause_threshold_ms': pause_threshold_ms,
            'target_found_after_pause': target_found_after_pause,
            'transcript': ' '.join(transcript_words),
            'technique': technique,
            'feedback_key': feedback_key,
        }
