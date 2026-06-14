"""Prompt enhancement endpoints compatible with the web client."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class EnhancePromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    style: str = Field(default="", max_length=500)
    negative_prompt: str = Field(default="", alias="negativePrompt")

    model_config = {"populate_by_name": True}


class EnhanceSingleRequest(BaseModel):
    object_name: str = Field(alias="objectName")
    prompt: str
    background: str
    global_style: str = Field(default="", alias="globalStyle")
    previous_prompt: str = Field(default="", alias="previousPrompt")
    scene_context: str = Field(default="", alias="sceneContext")

    model_config = {"populate_by_name": True}


@router.post("/enhance")
async def enhance_prompt(body: EnhancePromptRequest) -> dict[str, str]:
    return {
        "enhancedPrompt": ", ".join(value for value in [body.style, body.prompt] if value),
        "enhancedNegative": body.negative_prompt,
    }


@router.post("/enhance-single")
async def enhance_single(body: EnhanceSingleRequest) -> dict[str, str | bool]:
    prompt = ", ".join(
        value for value in [body.previous_prompt, body.prompt, body.global_style] if value
    )
    return {
        "prompt": prompt,
        "negativePrompt": "text, watermark, duplicate subject, malformed anatomy",
        "identityConstraints": body.previous_prompt or body.object_name,
        "preserveColors": True,
        "preservePose": not any(
            word in body.prompt for word in ("跑", "跳", "转身", "抬头", "低头")
        ),
    }
