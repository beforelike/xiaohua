"""语音识别路由

提供 ASR 相关接口，支持音频转写和健康检查。
"""

from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile

router = APIRouter()


@router.get("/health")
async def asr_health() -> dict[str, str | bool]:
    """ASR 服务健康检查

    检查 ASR 引擎是否可用。
    """
    # TODO: 实现实际的 ASR 健康检查
    return {"status": "ok", "available": True}


@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    file: Annotated[UploadFile, File(description="音频文件")],
) -> dict[str, str]:
    """音频转写

    接收音频文件，调用 ASR 引擎进行语音识别，返回转写文本。

    Args:
        file: 上传的音频文件（WAV/WebM/OGG）

    Returns:
        转写结果，包含识别的文本
    """
    # TODO: 实现实际的 ASR 转写逻辑
    request_id = getattr(request.state, "request_id", "unknown")
    return {
        "text": "",
        "error": "ASR 服务尚未实现，将在后续 PR 中完成",
        "requestId": request_id,
    }
