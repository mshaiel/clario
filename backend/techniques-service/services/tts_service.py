import edge_tts
import asyncio
import io
import base64
import logging
import subprocess
import shutil

logger = logging.getLogger(__name__)

VOICES = {
    'english': 'en-US-AriaNeural',
    'urdu': 'ur-PK-UzmaNeural',
}

FALLBACK_VOICE = 'en-US-AriaNeural'


class TTSService:
    @staticmethod
    async def synthesize(text: str, language: str = 'english') -> str:
        """
        Synthesize text to speech using edge-tts.
        Returns base64-encoded WAV audio bytes.
        Falls back to English voice if the requested voice fails.
        """
        voice = VOICES.get(language, FALLBACK_VOICE)
        try:
            return await TTSService._synthesize_with_voice(text, voice)
        except Exception as e:
            logger.warning(f'TTS voice {voice} failed ({e}), falling back to {FALLBACK_VOICE}')
            try:
                return await TTSService._synthesize_with_voice(text, FALLBACK_VOICE)
            except Exception as fallback_e:
                logger.error(f'Fallback TTS also failed ({fallback_e}). Returning empty audio.')
                return ""

    @staticmethod
    async def _synthesize_with_voice(text: str, voice: str) -> str:
        communicate = edge_tts.Communicate(text, voice)
        audio_buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                audio_buffer.write(chunk['data'])
        audio_buffer.seek(0)
        mp3_bytes = audio_buffer.read()
        try:
            wav_bytes = TTSService._convert_mp3_to_wav(mp3_bytes)
            return base64.b64encode(wav_bytes).decode('utf-8')
        except Exception as e:
            logger.warning(f'ffmpeg unavailable or conversion failed ({e}); returning mp3 base64 instead')
            return base64.b64encode(mp3_bytes).decode('utf-8')

    @staticmethod
    def _convert_mp3_to_wav(mp3_bytes: bytes) -> bytes:
        """Convert mp3 bytes to wav bytes using ffmpeg."""
        if not shutil.which('ffmpeg'):
            raise RuntimeError('ffmpeg not found in PATH')
        process = subprocess.run(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'wav', 'pipe:1'],
            input=mp3_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode != 0:
            raise RuntimeError(f'ffmpeg conversion failed: {process.stderr.decode("utf-8", errors="ignore")}')
        return process.stdout
