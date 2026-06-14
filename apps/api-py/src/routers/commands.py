"""命令解析路由

提供语音/文本命令的解析接口，将自然语言转换为结构化绘画命令。
"""

from fastapi import APIRouter, Request

from src.models.commands import ClarificationResult, DrawingCommand, ParseCommandRequest
from src.services.command_parser import parse_command

router = APIRouter()


@router.post("/parse")
async def parse_command_endpoint(
    request: Request,
    body: ParseCommandRequest,
) -> dict:
    """解析绘画命令

    接收用户的语音转写文本和当前画布上下文，返回以下三类结果之一：
    - DrawingCommand：可直接执行的结构化命令
    - ClarificationResult（含 kind="clarification"）：置信度不足或目标歧义，需用户确认
    - 错误对象（含 error 字段）：无法解析的指令

    Args:
        body: 包含文本和上下文的解析请求

    Returns:
        解析后的命令、澄清结果或错误信息
    """
    result = await parse_command(body)
    if isinstance(result, DrawingCommand | ClarificationResult):
        return result.model_dump(by_alias=True, exclude_none=True)
    return result
