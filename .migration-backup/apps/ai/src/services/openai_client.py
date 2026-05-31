"""OpenAI client wrappers.

Wrapped so test suites can stub `generate_quiz_questions` /
`moderate_text` without touching the live SDK. The wrappers DO NOT call
the network when `OPENAI_API_KEY` is empty — instead they return a small
deterministic stub so local/dev/CI flows keep working without billing.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from openai import OpenAI

from ..config import AiConfig

# ---------------------------------------------------------------------------
# Quiz generation
# ---------------------------------------------------------------------------

QUIZ_SYSTEM_PROMPT = """You write multiple-choice quiz questions for a Jain
religious-education platform (Jain Pathshala). The audience is children
and parents in India learning Jain principles, history, and Tirthankaras.

Rules:
- Every question has BOTH English and Hindi text. Hindi must use proper
  Devanagari script — never Hinglish, never Latin transliteration.
- Religious terms stay in Devanagari even in the English text (e.g.
  "Tirthankara", "Punya", "Pathshala").
- 4 options per question. EXACTLY ONE is correct.
- Questions are age-appropriate for the requested age_group.
- Topic stays tightly bound to Jain teachings — never invent secular facts.
- No emojis, no offensive content, no political content.

Output JSON ONLY matching the requested schema."""

QUIZ_JSON_SCHEMA: dict[str, Any] = {
    "name": "quiz_batch",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "question_en": {"type": "string"},
                        "question_hi": {"type": "string"},
                        "options": {
                            "type": "array",
                            "minItems": 4,
                            "maxItems": 4,
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "text_en": {"type": "string"},
                                    "text_hi": {"type": "string"},
                                },
                                "required": ["text_en", "text_hi"],
                            },
                        },
                        "correct_index": {"type": "integer", "minimum": 0, "maximum": 3},
                        "difficulty": {
                            "type": "string",
                            "enum": ["easy", "medium", "hard"],
                        },
                    },
                    "required": [
                        "question_en",
                        "question_hi",
                        "options",
                        "correct_index",
                        "difficulty",
                    ],
                },
            }
        },
        "required": ["questions"],
    },
    "strict": True,
}


def generate_quiz_questions(
    config: AiConfig,
    *,
    topic: str,
    age_group: str | None,
    language: str,
    count: int,
) -> list[dict[str, Any]]:
    """Return a list of question payloads matching the NestJS schema.

    If `OPENAI_API_KEY` is empty we return a deterministic stub so the
    whole pipeline (worker → FastAPI → callback) is exercised in tests
    and dev environments without spending real tokens.
    """

    if not config.openai_api_key:
        return _stub_questions(topic=topic, age_group=age_group, language=language, count=count)

    client = OpenAI(api_key=config.openai_api_key)
    user_prompt = (
        f"Create {count} multiple-choice quiz questions about "
        f"\"{topic}\". Age group: {age_group or 'mixed'}. "
        f"Primary language: {language}. Match the JSON schema exactly."
    )

    response = client.chat.completions.create(
        model=config.openai_model,
        messages=[
            {"role": "system", "content": QUIZ_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_schema", "json_schema": QUIZ_JSON_SCHEMA},
        temperature=0.4,
    )
    content = response.choices[0].message.content or "{}"
    parsed = json.loads(content)
    return list(parsed.get("questions", []))


# ---------------------------------------------------------------------------
# Image moderation
# ---------------------------------------------------------------------------


def moderate_image_url(config: AiConfig, image_url: str) -> dict[str, Any]:
    """Run OpenAI image moderation on the URL. Returns the verdict dict.

    Stub mode: returns flagged=False when no API key.
    """
    if not config.openai_api_key:
        return {"flagged": False, "categories": {}, "scores": {}, "_stub": True}
    client = OpenAI(api_key=config.openai_api_key)
    res = client.moderations.create(
        model=config.moderation_model,
        input=[{"type": "image_url", "image_url": {"url": image_url}}],
    )
    item = res.results[0]
    return {
        "flagged": bool(item.flagged),
        "categories": item.categories.model_dump() if item.categories else {},
        "scores": item.category_scores.model_dump() if item.category_scores else {},
    }


# ---------------------------------------------------------------------------
# Deterministic stub used in dev / tests
# ---------------------------------------------------------------------------


def _stub_questions(
    *, topic: str, age_group: str | None, language: str, count: int
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    short = (topic[:24]).strip() or "Jain teachings"
    for i in range(count):
        marker = f"#{i + 1}"
        out.append(
            {
                "question_en": f"{marker} Which statement about {short} is correct?",
                "question_hi": f"{marker} {short} के बारे में कौन-सा कथन सही है?",
                "options": [
                    {"text_en": "It is a core teaching.", "text_hi": "यह एक प्रमुख शिक्षा है।"},
                    {"text_en": "It contradicts ahimsa.", "text_hi": "यह अहिंसा का विरोध करता है।"},
                    {"text_en": "It applies only to monks.", "text_hi": "यह केवल साधुओं पर लागू है।"},
                    {"text_en": "It is unrelated to Jainism.", "text_hi": "यह जैन धर्म से असंबंधित है।"},
                ],
                "correct_index": 0,
                "difficulty": "medium" if (age_group or "") in ("tarun", "yuva") else "easy",
            }
        )
    # tag with a uuid so the same call doesn't dedupe across requests
    out_marker = uuid.uuid4().hex[:6]
    for q in out:
        q["_stub_request"] = out_marker
        q["_language"] = language
    return out
