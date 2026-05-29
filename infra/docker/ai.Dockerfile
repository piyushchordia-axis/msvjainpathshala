# syntax=docker/dockerfile:1.6
# Jain Pathshala — AI service (apps/ai). SPEC §3.5, §4.6, §18.
#
# Single-stage image; the Python toolchain doesn't benefit from multi-stage
# the way Node does (no transpile step). Runs uvicorn directly; the
# production deployment fronts this with the internal ALB which enforces
# its own security-group IP allowlist (the in-process middleware is
# defence in depth).

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# System deps: curl for healthchecks, build-essential dropped — pure Python
# stack uses prebuilt wheels.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/ai/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Application source lives under /app/src so imports resolve as `src.*`.
COPY apps/ai/src ./src
COPY apps/ai/pyproject.toml ./pyproject.toml

# Non-root user; ECS-friendly and matches the API container convention.
RUN useradd --uid 1001 --user-group --no-create-home jp \
  && chown -R jp:jp /app
USER jp

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# uvicorn workers tuned for CPU bound LLM I/O — 2 workers, async event loop.
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
