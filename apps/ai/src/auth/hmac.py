"""HMAC + IP-allowlist verification (SPEC §3.5, §16.7).

NestJS signs every request with:

    X-Signature: hex(HMAC-SHA256(secret, body))
    X-Timestamp: unix epoch seconds

The signature covers the raw request body — we use constant-time comparison
so attackers can't tease the secret out of timing differences. The timestamp
provides anti-replay: anything older than `hmac_timestamp_skew_seconds` is
rejected even if the signature is otherwise valid.

The IP allowlist is enforced before HMAC verification so a misconfigured
client never reaches the cryptographic check — failing closed is cheaper
than failing safely.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse

from ..config import AiConfig


def _client_ip(request: Request) -> str | None:
    # Behind ALB / nginx we trust X-Forwarded-For. Production sets this at
    # the LB; for direct tests, request.client is enough.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _ip_allowed(ip_str: str | None, allowlist: tuple) -> bool:
    if not allowlist:
        # Empty allowlist = no restriction. Useful in dev where the dev box
        # talks to itself; production should ALWAYS configure this.
        return True
    if ip_str is None:
        return False
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return any(ip in network for network in allowlist)


def _err(code: str, message: str, http_status: int) -> JSONResponse:
    return JSONResponse(
        status_code=http_status,
        content={"error": {"code": code, "message": message}},
    )


def make_hmac_middleware(
    config: AiConfig,
) -> Callable[[Request, Callable[[Request], Awaitable[Response]]], Awaitable[Response]]:
    """FastAPI middleware that enforces IP allowlist + HMAC signature.

    Skips public health endpoints (/health, /readyz) so liveness probes don't
    need to sign requests.
    """

    public_paths = {"/health", "/readyz", "/livez"}

    async def middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.url.path in public_paths:
            return await call_next(request)

        client_ip = _client_ip(request)
        if not _ip_allowed(client_ip, config.ip_allowlist):
            return _err(
                "ERR_AI_IP_NOT_ALLOWED",
                f"Client IP {client_ip!r} is not in the allowlist",
                status.HTTP_403_FORBIDDEN,
            )

        signature = request.headers.get("x-signature", "")
        timestamp_raw = request.headers.get("x-timestamp", "")
        if not signature or not timestamp_raw:
            return _err(
                "ERR_AI_HMAC_MISSING",
                "Both X-Signature and X-Timestamp headers are required",
                status.HTTP_401_UNAUTHORIZED,
            )

        try:
            ts = int(timestamp_raw)
        except ValueError:
            return _err(
                "ERR_AI_HMAC_TIMESTAMP",
                "X-Timestamp must be a unix epoch integer",
                status.HTTP_401_UNAUTHORIZED,
            )
        now = int(time.time())
        if abs(now - ts) > config.hmac_timestamp_skew_seconds:
            return _err(
                "ERR_AI_HMAC_REPLAY",
                f"X-Timestamp skew of {abs(now - ts)}s exceeds limit",
                status.HTTP_401_UNAUTHORIZED,
            )

        # Read body ONCE, then re-attach so downstream handlers can consume it.
        body = await request.body()
        expected = hmac.new(
            config.hmac_secret.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature.lower()):
            return _err(
                "ERR_AI_HMAC_INVALID",
                "X-Signature does not match the request body",
                status.HTTP_401_UNAUTHORIZED,
            )

        # Re-inject the body for the route handler.
        async def receive() -> dict[str, object]:
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive  # type: ignore[attr-defined]
        return await call_next(request)

    return middleware


def sign_payload(secret: str, body: bytes, timestamp: int | None = None) -> tuple[str, int]:
    """Helper used by NestJS-bound callbacks (and the test suite).

    Returns (X-Signature, X-Timestamp).
    """
    ts = timestamp if timestamp is not None else int(time.time())
    sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return sig, ts
