"""Runtime configuration for the AI service.

All values are sourced from environment variables. The service refuses to
start in production if `AI_SERVICE_HMAC_SECRET` is unset — there is no
auth fallback besides HMAC + IP allowlist.
"""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass


def _split_csv(raw: str) -> list[str]:
    return [s.strip() for s in raw.split(",") if s.strip()]


@dataclass(frozen=True)
class AiConfig:
    """Immutable runtime config bag — built once at boot."""

    env: str
    port: int
    log_level: str
    hmac_secret: str
    ip_allowlist: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]
    nestjs_base_url: str
    nestjs_callback_path: str
    openai_api_key: str
    openai_model: str
    moderation_model: str
    moderation_enabled: bool
    # Max age allowed for the X-Timestamp header (anti-replay), seconds.
    hmac_timestamp_skew_seconds: int


def load_config() -> AiConfig:
    """Read env vars and validate. Raises ValueError on missing required keys."""

    env = os.environ.get("AI_ENV", "development").lower()
    secret = os.environ.get("AI_SERVICE_HMAC_SECRET", "")
    if env == "production" and not secret:
        raise ValueError("AI_SERVICE_HMAC_SECRET is required in production")

    raw_allow = os.environ.get("AI_SERVICE_IP_ALLOWLIST", "")
    cidrs: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for entry in _split_csv(raw_allow):
        try:
            cidrs.append(ipaddress.ip_network(entry, strict=False))
        except ValueError as e:
            raise ValueError(f"AI_SERVICE_IP_ALLOWLIST entry not a valid CIDR: {entry}") from e

    return AiConfig(
        env=env,
        port=int(os.environ.get("AI_PORT", "8000")),
        log_level=os.environ.get("AI_LOG_LEVEL", "info"),
        hmac_secret=secret or "dev-secret",
        ip_allowlist=tuple(cidrs),
        nestjs_base_url=os.environ.get("NESTJS_BASE_URL", "http://localhost:3000"),
        nestjs_callback_path=os.environ.get(
            "NESTJS_AI_CALLBACK_PATH", "/v1/questions/ai-batch"
        ),
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        openai_model=os.environ.get("AI_OPENAI_MODEL", "gpt-4o-mini"),
        moderation_model=os.environ.get("AI_MODERATION_MODEL", "omni-moderation-latest"),
        moderation_enabled=os.environ.get("AI_MODERATION_ENABLED", "false").lower() == "true",
        hmac_timestamp_skew_seconds=int(os.environ.get("AI_HMAC_SKEW_SECONDS", "300")),
    )
