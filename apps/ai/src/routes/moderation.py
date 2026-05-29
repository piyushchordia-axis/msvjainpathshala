"""POST /ai/moderation/image — image moderation pipeline (gallery, niyam).

Returns a verdict the NestJS caller persists onto the media_assets row.
Behind `AI_MODERATION_ENABLED` — when disabled, the endpoint returns 503
so a misconfigured deploy is obvious.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..services.openai_client import moderate_image_url

router = APIRouter(prefix="/ai", tags=["moderation"])


class ModerationRequest(BaseModel):
    media_asset_id: str = Field(..., description="media_assets.id (echoed on callback)")
    image_url: str = Field(..., description="Signed URL the OpenAI API can reach")


class ModerationResponse(BaseModel):
    media_asset_id: str
    flagged: bool
    categories: dict[str, bool]
    scores: dict[str, float]


@router.post("/moderation/image", response_model=ModerationResponse)
async def moderate_image(request: Request, body: ModerationRequest) -> ModerationResponse:
    config = request.app.state.config
    if not config.moderation_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Moderation is disabled (AI_MODERATION_ENABLED=false)",
        )
    verdict = moderate_image_url(config, body.image_url)
    return ModerationResponse(
        media_asset_id=body.media_asset_id,
        flagged=bool(verdict.get("flagged", False)),
        categories={k: bool(v) for k, v in verdict.get("categories", {}).items()},
        scores={k: float(v) for k, v in verdict.get("scores", {}).items()},
    )
