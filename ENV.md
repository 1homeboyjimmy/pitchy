# Environment variables

## Backend

- `APP_ENV`: `dev` or `prod`.
- `APP_SECRET_KEY`: JWT signing secret.
- `APP_TOKEN_EXPIRE_MINUTES`: Access token TTL in minutes.
- `APP_PUBLIC_URL`: Public URL used in email links.
- `FRONTEND_ORIGINS`: Comma-separated CORS origins.
- `DATABASE_URL`: SQLAlchemy URL (PostgreSQL in prod).
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`: YooKassa credentials for billing.
- `BILLING_CRON_SECRET`: shared secret for the subscription renewal cron endpoint and GitHub Actions workflow.
- `REDIS_URL`: Redis connection URL for rate limiting.
- `CUSTDEV_SSO_CLIENT_ID`: registered CustDev SSO client identifier.
- `CUSTDEV_SSO_REDIRECT_URI`: exact, pre-registered CustDev callback URI.
- `CUSTDEV_SSO_SERVICE_SECRET`: separate HMAC secret for CustDev-to-Pitchy calls; never reuse `APP_SECRET_KEY`.
- `CUSTDEV_SSO_CODE_TTL`, `CUSTDEV_SSO_GRANT_TTL`: one-time code and scoped grant lifetimes.
- `AUTH_COOKIE_HOST_ONLY`: migration switch for the main session cookie; enable only after CustDev `code_exchange` is verified.
- `LOCKBOX_CUSTDEV_SSO_SERVICE_SECRET_SECRET_ID` / `..._ENTRY_KEY`: optional Lockbox source for the CustDev service secret.
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
- `EXA_API_KEY`: Exa key for web search.
- `LOCKBOX_EXA_API_KEY_SECRET_ID` / `..._ENTRY_KEY`: optional Lockbox source for the shared Exa web-search key.
- `POLZA_API_KEY`: Polza key for chat, structured LLM calls, and embeddings.
- `LOCKBOX_POLZA_API_KEY_SECRET_ID` / `LOCKBOX_POLZA_API_KEY_ENTRY_KEY`: optional Lockbox source for the Polza key.
- `POLZA_API_BASE`: Polza OpenAI-compatible API base (defaults to `https://polza.ai/api/v1`).
- `AUDIENCE_PERSONA_MODEL`: model used for persona generation, interviews, and summaries (defaults to `openai/gpt-6-luna-pro`).
- `AUDIENCE_SEARCH_MODEL`: web-grounded model used for audience evidence (defaults to `perplexity/sonar`).
- `AUDIENCE_SEARCH_CONTEXT_SIZE`: Perplexity search depth (`low`, `medium`, or `high`; defaults to `low`).
- `PUBLIC_SITE_URL`: canonical web origin embedded in exhibition claim QR codes; use the staging origin in staging.
- `POLZA_EMBEDDING_MODEL`: RAG embedding model (defaults to `qwen/qwen3-embedding-4b`). Changing it rebuilds incompatible Chroma collections at RAG startup.
- `ROUTERAI_API_KEY`: RouterAI key used only by the dedicated reranker.
- `LOCKBOX_ROUTERAI_API_KEY_SECRET_ID` / `LOCKBOX_ROUTERAI_API_KEY_ENTRY_KEY`: optional Lockbox source for the reranker key.
- `ROUTERAI_API_BASE`: RouterAI API base (defaults to `https://routerai.ru/api/v1`).
- `ROUTERAI_RERANK_MODEL`: dedicated reranker model (defaults to `cohere/rerank-v3.5`).
- `EXA_HTTPS_PROXY`: HTTP CONNECT proxy for `api.exa.ai` (`http://user:pass@host:port`).
  Required on RU hosts — Cloudflare answers 403 there, and the search silently
  degrades to "Интернет-поиск временно недоступен" without it. `SEARCH_HTTPS_PROXY`
  is accepted as a fallback so a box also running the media stack can share one value.
- `EXA_BASE_URL`: Override the Exa API base (default `https://api.exa.ai`).
- `EXA_TIMEOUT_SECONDS`: Search request timeout (default `30`).
- `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`: Yandex OAuth application credentials.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: optional social-login credentials.

## Frontend

- `NEXT_PUBLIC_API_BASE_URL`: Backend base URL.
