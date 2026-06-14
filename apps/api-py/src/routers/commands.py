"""命令解析路由

提供语音/文本命令的解析接口，将自然语言转换为结构化绘画命令。
"""

from fastapi import APIRouter, Request

from src.models.commands import DrawingCommand, ParseCommandRequest
from src.services.command_parser import parse_command

router = APIRouter()


@router.post("/parse")
async def parse_command_endpoint(
    request: Request,
    body: ParseCommandRequest,
) -> dict:
    """解析绘画命令

    接收用户的语音转写文本和当前画布上下文，
    返回结构化的绘画命令。

    Args:
        body: 包含文本和上下文的解析请求

    Returns:
        解析后的 DrawingCommand 或错误信息
    """
    result = parse_command(body)
    if isinstance(result, DrawingCommand):
        return result.model_dump(by_alias=True, exclude_none=True)
    return result
