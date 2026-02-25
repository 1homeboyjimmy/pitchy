FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.hf_cache

WORKDIR /app

# Install CPU-only torch FIRST to save space and prevent cache busts from requirements.txt
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .

RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY . .

# Pre-download embedding model into HuggingFace cache inside image
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('intfloat/multilingual-e5-small')" \
    && echo 'Model cached at:' && du -sh /app/.hf_cache/

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
