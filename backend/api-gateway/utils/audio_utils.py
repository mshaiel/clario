"""
audio_utils.py — REMOVED

This module contained WebSocket audio-frame utilities (decode_audio_frame,
is_speech_active) that were only used by the now-removed WebSocket
architecture. The codebase has been migrated to a stateless REST model
where audio is delivered as multipart/form-data UploadFile, making these
helpers unnecessary.
"""


def audio_mime_type(audio_bytes: bytes) -> str:
    """
    Detect audio format from magic bytes.
    edge-tts returns MP3 (ID3 header or sync frame);
    Coqui XTTS v2 returns WAV (RIFF header).
    """
    if (
        audio_bytes[:3] == b"ID3"
        or (len(audio_bytes) >= 2 and audio_bytes[0] == 0xFF and (audio_bytes[1] & 0xE0) == 0xE0)
    ):
        return "audio/mpeg"
    return "audio/wav"
