FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.hf_cache

WORKDIR /app

# Install curl for deploy healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# --- LAYER 1: Torch (cached unless base image changes) ---
# Use pip cache mount so torch (188MB) is only downloaded once
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# --- LAYER 2: Requirements (cached unless requirements.txt changes) ---
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# --- LAYER 3: Pre-download embedding model (cached unless requirements change) ---
# Model download BEFORE code copy so code-only changes don't re-download the 466MB model
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('intfloat/multilingual-e5-small')" \
    && echo 'Model cached at:' && du -sh /app/.hf_cache/

# --- LAYER 4: Code (only this layer rebuilds on code changes) ---
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
