"""POST drafted questions back to the NestJS API.

The NestJS endpoint `/v1/questions/ai-batch` is HMAC-protected by the same
shared secret. We sign each callback with `X-Signature` + `X-Timestamp` so
NestJS's HmacGuard accepts the request.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from ..auth.hmac import sign_payload
from ..config import AiConfig

logger = logging.getLogger("ai.nestjs_callback")


async def post_ai_batch(
    config: AiConfig, *, job_id: str, questions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Post the drafted questions back to NestJS. Returns the response JSON."""

    url = config.nestjs_base_url.rstrip("/") + config.nestjs_callback_path
    payload = {"job_id": job_id, "questions": questions}
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature, timestamp = sign_payload(config.hmac_secret, body)
    headers = {
        "content-type": "application/json",
        "x-signature": signature,
        "x-timestamp": str(timestamp),
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, content=body, headers=headers)
        if resp.status_code >= 400:
            logger.error(
                "ai-batch callback failed: status=%s body=%s", resp.status_code, resp.text[:500]
            )
            resp.raise_for_status()
        return resp.json()
