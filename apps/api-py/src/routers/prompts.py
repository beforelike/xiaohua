"""提示词路由

提供提示词增强和扩展接口。
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter()


class EnhancePromptRequest(BaseModel):
    """提示词增强请求"""

    prompt: str = Field(min_length=1, max_length=2000, description="原始提示词")
    style: str = Field(default="", max_length=500, description="画风描述")
    negative_prompt: str = Field(
        default="", max_length=2000, alias="negativePrompt", description="负向提示词"
    )

    model_config = {"populate_by_name": True}


class EnhancePromptResponse(BaseModel):
    """提示词增强响应"""

    enhanced_prompt: str = Field(alias="enhancedPrompt", description="增强后的正向提示词")
    enhanced_negative: str = Field(
        alias="enhancedNegative", description="增强后的负向提示词"
    )

    model_config = {"populate_by_name": True}


@router.post("/enhance")
async def enhance_prompt(
    request: Request,
    body: EnhancePromptRequest,
) -> EnhancePromptResponse:
    """增强提示词

    使用 GPT-2 expansion 或 LLM 对用户提示词进行增强，
    添加质量标签和风格关键词。

    Args:
        body: 提示词增强请求

    Returns:
        EnhancePromptResponse: 增强后的正/负向提示词
    """
    # TODO: Task 5 实现完整的提示词增强逻辑
    return EnhancePromptResponse(
        enhancedPrompt=body.prompt,
        enhancedNegative=body.negative_prompt or "",
    )
