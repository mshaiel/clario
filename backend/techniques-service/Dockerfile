FROM python:3.10-slim-bookworm

# 1. Create a non-root user with UID 1000 for Hugging Face Spaces
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# 2. Switch back to root temporarily to install system dependencies
USER root
RUN apt-get update && apt-get install -y \
    ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# 3. Copy requirements and install them as the user
USER user
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir --no-build-isolation openai-whisper==20231117

# 4. Copy the rest of the application
COPY --chown=user . .

# 5. Seed the SQLite database on build
RUN python data/seed_db.py

# 6. Pre-download models during build to avoid runtime delays and race conditions
RUN python -c "import torch; torch.hub.load('snakers4/silero-vad', 'silero_vad', force_reload=False, trust_repo=True); import whisper; whisper.load_model('base')" && \
    find $HOME/.cache/torch/hub/ -name "*.lock" -delete || true

# 7. Prevent PyTorch/NumPy from spawning too many threads and hanging inside Docker
ENV OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    VECLIB_MAXIMUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    PYTORCH_ENABLE_MPS_FALLBACK=1

EXPOSE 7860

# Use 1 worker to prevent multiprocessing race conditions with PyTorch hub and models
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
