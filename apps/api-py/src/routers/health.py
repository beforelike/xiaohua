"""健康检查与系统信息路由"""

from fastapi import APIRouter

from src.config import get_settings, list_presets, load_preset
from src.services.fooocus_adapter import inspect_runtime

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """健康检查端点

    返回服务运行状态，用于负载均衡和监控探针。
    """
    settings = get_settings()
    return {
        "status": "ok",
        "service": "xiaohua-api",
        "version": "0.1.0",
        "commandProvider": settings.command_provider,
        "imageProvider": settings.image_provider,
        "asrProvider": settings.asr_provider,
        "llmConfigured": bool(
            settings.llm_base_url and settings.llm_model and settings.llm_api_key
        ),
        "fooocus": inspect_runtime(settings).as_dict(),
    }


@router.get("/health/ready")
async def readiness_check() -> dict:
    """就绪检查端点

    检查服务是否准备好接收请求（模型是否已加载等）。
    骨架阶段始终返回 ready。
    """
    settings = get_settings()
    runtime = inspect_runtime(settings)
    ready = settings.image_provider == "mock" or runtime.ready
    return {
        "status": "ok" if ready else "not_ready",
        "ready": ready,
        "fooocus": runtime.as_dict(),
    }


@router.get("/presets")
async def get_presets() -> dict[str, list[str] | str]:
    """获取可用预设列表及当前激活的预设

    Returns:
        presets: 可用预设名称列表
        active: 当前激活的预设名称
    """
    settings = get_settings()
    return {
        "presets": list_presets(),
        "active": settings.preset,
    }


@router.get("/presets/{preset_name}")
async def get_preset_detail(preset_name: str) -> dict:
    """获取指定预设的详细配置

    Args:
        preset_name: 预设名称

    Returns:
        预设配置内容
    """
    data = load_preset(preset_name)
    if not data:
        return {"error": f"预设 '{preset_name}' 不存在"}
    return {"name": preset_name, "config": data}
