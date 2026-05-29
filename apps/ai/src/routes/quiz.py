"""POST /ai/quiz/generate — drafts MCQs and posts them to NestJS.

Synchronous from the NestJS worker's perspective: the worker calls this
endpoint and awaits the response. The endpoint:

1. Calls OpenAI (or its stub) to draft `count` questions.
2. POSTs the drafted batch to NestJS `/v1/questions/ai-batch` with HMAC.
3. Returns `{ job_id, generated_count, accepted_count }`.

The total request budget is 60s (NestJS-side timeout) — well above the
typical 5-10s GPT-4o-mini call.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import AiConfig
from ..services.nestjs_callback import post_ai_batch
from ..services.openai_client import generate_quiz_questions

router = APIRouter(prefix="/ai", tags=["quiz"])


class QuizGenerateRequest(BaseModel):
    job_id: str = Field(..., description="ai_generation_jobs.id from NestJS")
    topic: str = Field(..., min_length=3, max_length=140)
    age_group: str | None = Field(None, description="bal | kishor | tarun | yuva")
    language: str = Field("en", pattern="^(en|hi)$")
    count: int = Field(10, ge=1, le=25)


class QuizGenerateResponse(BaseModel):
    job_id: str
    generated_count: int
    accepted_count: int
    questions_preview: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/quiz/generate", response_model=QuizGenerateResponse)
async def generate_quiz(request: Request, body: QuizGenerateRequest) -> QuizGenerateResponse:
    config: AiConfig = request.app.state.config
    try:
        questions = generate_quiz_questions(
            config,
            topic=body.topic,
            age_group=body.age_group,
            language=body.language,
            count=body.count,
        )
    except Exception as exc:  # pragma: no cover — OpenAI surface area is broad
        raise HTTPException(status_code=502, detail=f"OpenAI call failed: {exc}") from exc

    if not questions:
        raise HTTPException(status_code=502, detail="AI returned zero questions")

    callback = await post_ai_batch(config, job_id=body.job_id, questions=questions)

    accepted = int(callback.get("data", {}).get("accepted_count", len(questions)))

    return QuizGenerateResponse(
        job_id=body.job_id,
        generated_count=len(questions),
        accepted_count=accepted,
        questions_preview=questions[:3],
    )
