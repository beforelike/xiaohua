"""ASR health and transcription proxy."""

import httpx
from fastapi import APIRouter, HTTPException, Request

from src.config import get_settings

router = APIRouter()


@router.get("/health")
async def asr_health() -> dict[str, str | bool]:
    settings = get_settings()
    if settings.asr_provider == "mock":
        return {"provider": "mock", "available": False}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(f"{settings.asr_endpoint.rstrip('/')}/health")
        return {"provider": settings.asr_provider, "available": response.is_success}
    except httpx.HTTPError:
        return {"provider": settings.asr_provider, "available": False}


@router.post("/transcribe")
async def transcribe_audio(request: Request) -> dict[str, str]:
    settings = get_settings()
    if settings.asr_provider == "mock":
        raise HTTPException(status_code=503, detail="ASR 服务未配置")
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="没有收到可识别的音频")
    content_type = request.headers.get("content-type", "audio/webm")
    filename = "voice.wav" if "wav" in content_type else "voice.webm"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            f"{settings.asr_endpoint.rstrip('/')}/v1/audio/transcriptions",
            files={"file": (filename, audio, content_type)},
            data={"model": "whisper-1", "language": "zh"},
        )
    if not response.is_success:
        raise HTTPException(status_code=502, detail="ASR 服务识别失败")
    text = str(response.json().get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=502, detail="ASR 未返回识别文本")
    return {"text": text}
