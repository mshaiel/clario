FROM python:3.10.14-slim

# Install OS-level dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    build-essential \
    pkg-config \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code

# 1. Install Python dependencies (cached as a layer)
COPY requirements.txt /code/
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

# 2. Pre-download all AI models (Wav2Vec2 + Whisper + Allosaurus)
#    This caches ~2 GB of weights so production cold-starts are instant.
COPY download_models.py /code/
RUN python download_models.py

# 3. Copy application code
COPY . /code/

# Run as non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /code
USER appuser

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:7860/')" || exit 1

CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "7860"]
