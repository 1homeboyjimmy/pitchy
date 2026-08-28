# --- STAGE 1: Builder ---
FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install build dependencies for heavy C-extensions (like multidict inside aiohttp or chromadb deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Pre-compile wheels to speed up future installs and keep the runner stage clean
RUN --mount=type=cache,target=/root/.cache/pip \
    pip wheel --no-cache-dir --no-deps --wheel-dir /app/wheels -r requirements.txt

# --- STAGE 2: Runner ---
FROM python:3.11-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install runtime dependencies: curl for healthchecks; pango + fonts for
# WeasyPrint PDF export (export_service.py). Brand fonts and monochrome
# emoji are bundled in assets/fonts/ via @font-face (WeasyPrint can't render
# the CBDT-bitmap color emoji font from apt); DejaVu covers fallback glyphs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz-subset0 \
    fontconfig \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install packages from wheels collected in the builder stage
COPY --from=builder /app/wheels /wheels
COPY --from=builder /app/requirements.txt .
RUN pip install --no-cache-dir --find-links=/wheels -r requirements.txt

# Force cache invalidation for the source-copy layer whenever the commit changes.
# Wheel install above stays cached when requirements.txt is unchanged; only the
# COPY of application code and anything after it rebuilds.
ARG GIT_SHA=unknown
RUN echo "$GIT_SHA" > /tmp/.git_sha

# Copy application code
COPY . .

EXPOSE 8000

# Run pending alembic migrations at container start, then exec uvicorn. If
# the upgrade fails, container exits non-zero, deploy healthcheck fires red,
# and we never end up with a backend running on an outdated schema (which
# is what happened in commit 62a4044 — the deploy workflow's manual exec
# step silently no-op'd because the container wasn't ready yet).
CMD ["sh", "-c", "python -m alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000"]

# CI target: exercising the real runtime image catches missing packages and
# migration incompatibilities in addition to application-level regressions.
FROM runtime AS accelerator-tests
RUN python -m pytest \
    tests/test_accelerator_foundation.py \
    tests/test_accelerator_roadmap_context.py \
    tests/test_grant_accelerator_context.py \
    tests/test_accelerator_notifications.py \
    tests/test_accelerator_teams.py \
    tests/test_accelerator_alumni.py \
    tests/test_accelerator_operations.py \
    tests/test_accelerator_router_contract.py \
    tests/test_roadmap_analysis_model.py \
    tests/test_roadmap_service.py

FROM runtime AS production
