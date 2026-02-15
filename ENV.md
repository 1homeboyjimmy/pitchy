# Environment variables

## Backend

- `APP_ENV`: `dev` or `prod`.
- `APP_SECRET_KEY`: JWT signing secret.
- `APP_TOKEN_EXPIRE_MINUTES`: Access token TTL in minutes.
- `APP_PUBLIC_URL`: Public URL used in email links.
- `FRONTEND_ORIGINS`: Comma-separated CORS origins.
- `DATABASE_URL`: SQLAlchemy URL (PostgreSQL in prod).
- `REDIS_URL`: Redis connection URL for rate limiting.
- `CHROMA_PERSIST_DIR`: Filesystem path for Chroma persistent data.
- `CHROMA_COLLECTION`: Chroma collection name.
- `CHROMA_DOCS_DIR`: Directory with seed documents for RAG.
- `CHROMA_REINDEX`: Rebuild collection on startup (`true`/`false`).
- `CHROMA_HTTP_HOST`: Use Chroma HTTP server if set.
- `CHROMA_HTTP_PORT`: Chroma HTTP port (default `8000`).
- `YC_API_KEY`: Optional API key (Authorization: Api-Key).
- `YC_IAM_TOKEN`: Optional static IAM token.
- `YC_SA_KEY_PATH`: Path to Yandex Cloud SA JSON key.
- `YC_FOLDER_ID`: Yandex Cloud folder id.
- `YC_GPT_ENDPOINT`: Yandex GPT endpoint override.
- `YC_GPT_MODEL_URI`: Model URI override.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS`: SMTP settings.
- `LOG_LEVEL`: Logging level (e.g. `INFO`, `DEBUG`).
- `AUTH_RATE_WINDOW_SECONDS`: Rate limit window in seconds.
- `AUTH_RATE_MAX`: Max auth requests per window per IP.

## Frontend

- `NEXT_PUBLIC_API_BASE_URL`: Backend base URL.
