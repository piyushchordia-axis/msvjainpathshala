"""FastAPI entrypoint — wires up middleware + routes.

Boot:
    uvicorn src.main:app --host 0.0.0.0 --port 8000

The `app.state.config` slot holds the immutable `AiConfig`. Routes read
it via `request.app.state.config` to avoid re-parsing env on every call.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from .auth.hmac import make_hmac_middleware
from .config import AiConfig, load_config
from .routes import moderation, quiz


def create_app(config: AiConfig | None = None) -> FastAPI:
    config = config or load_config()
    logging.basicConfig(level=config.log_level.upper())
    log = logging.getLogger("ai.bootstrap")

    app = FastAPI(
        title="Jain Pathshala — AI service",
        version="0.1.0",
        docs_url=None,  # Internal; no Swagger UI in prod
        redoc_url=None,
    )
    app.state.config = config

    # Health endpoints are public — the HMAC middleware whitelists them.
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "jp-ai", "env": config.env}

    @app.get("/livez")
    async def livez() -> dict[str, str]:
        return {"status": "alive"}

    @app.get("/readyz")
    async def readyz() -> dict[str, str | bool]:
        return {
            "status": "ready",
            "openai_configured": bool(config.openai_api_key),
            "moderation_enabled": config.moderation_enabled,
        }

    # Middlewares run in reverse-registration order on the way in. We want
    # HMAC verification BEFORE route handlers, so register it last.
    app.middleware("http")(make_hmac_middleware(config))

    app.include_router(quiz.router)
    app.include_router(moderation.router)

    log.info(
        "AI service booted env=%s allowlist=%d openai=%s",
        config.env,
        len(config.ip_allowlist),
        "live" if config.openai_api_key else "stub",
    )
    return app


app = create_app()
