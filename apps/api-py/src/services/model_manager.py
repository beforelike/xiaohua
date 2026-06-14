"""模型管理与自动下载

参考 Fooocus launch.py 实现模型文件的检查、下载和目录管理。
确保所有必要的模型文件在首次运行时自动就位。
"""

import hashlib
import logging
from pathlib import Path
from typing import Any

from src.config import Settings, get_settings

logger = logging.getLogger(__name__)

# 默认模型下载源（示例，实际使用时可配置镜像）
DEFAULT_CHECKPOINT_DOWNLOADS: dict[str, str] = {
    "juggernautXL_v8Rundiffusion.safetensors": (
        "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0"
        "/resolve/main/sd_xl_base_1.0.safetensors"
    ),
}

DEFAULT_LORA_DOWNLOADS: dict[str, str] = {
    "sd_xl_offset_example-lora_1.0.safetensors": (
        "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0"
        "/resolve/main/sd_xl_offset_example-lora_1.0.safetensors"
    ),
}


def ensure_directory(dir_path: str | Path) -> Path:
    """确保目录存在，不存在则创建

    Args:
        dir_path: 目录路径

    Returns:
        Path 对象
    """
    path = Path(dir_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_model_directories(settings: Settings | None = None) -> dict[str, Path]:
    """确保所有模型目录存在

    Args:
        settings: 配置实例

    Returns:
        目录名到 Path 的映射
    """
    if settings is None:
        settings = get_settings()

    dirs: dict[str, Path] = {}
    model_paths = settings.model_paths

    dirs["checkpoints"] = ensure_directory(model_paths.checkpoints)
    dirs["loras"] = ensure_directory(model_paths.loras)
    dirs["vae"] = ensure_directory(model_paths.vae)
    dirs["controlnet"] = ensure_directory(model_paths.controlnet)
    dirs["inpaint"] = ensure_directory(model_paths.inpaint)
    dirs["vae_approx"] = ensure_directory(model_paths.vae_approx)
    dirs["prompt_expansion"] = ensure_directory(model_paths.prompt_expansion)

    # 输出目录
    ensure_directory(settings.output_dir)

    logger.info("模型目录已就绪: %s", list(dirs.keys()))
    return dirs


def check_model_exists(filename: str, model_dir: str | Path) -> bool:
    """检查模型文件是否存在

    Args:
        filename: 模型文件名
        model_dir: 模型目录

    Returns:
        文件是否存在
    """
    return (Path(model_dir) / filename).exists()


def get_file_hash(file_path: str | Path, algorithm: str = "sha256") -> str:
    """计算文件哈希（用于校验下载完整性）

    Args:
        file_path: 文件路径
        algorithm: 哈希算法（默认 sha256）

    Returns:
        十六进制哈希字符串
    """
    h = hashlib.new(algorithm)
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


async def download_model(
    url: str,
    dest_path: str | Path,
    expected_hash: str | None = None,
    progress_callback: Any = None,
) -> bool:
    """异步下载模型文件

    Args:
        url: 下载 URL
        dest_path: 目标保存路径
        expected_hash: 预期的文件哈希（用于校验）
        progress_callback: 进度回调 (downloaded_bytes, total_bytes)

    Returns:
        是否下载成功
    """
    import httpx

    dest = Path(dest_path)
    temp_path = dest.with_suffix(dest.suffix + ".tmp")

    logger.info("开始下载: %s -> %s", url, dest)

    try:
        async with (
            httpx.AsyncClient(follow_redirects=True, timeout=300) as client,
            client.stream("GET", url) as response,
        ):
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))

            downloaded = 0
            with open(temp_path, "wb") as f:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_callback and total:
                        progress_callback(downloaded, total)

        # 校验哈希
        if expected_hash:
            actual_hash = get_file_hash(temp_path)
            if actual_hash != expected_hash:
                logger.error("文件哈希不匹配: expected=%s, actual=%s", expected_hash, actual_hash)
                temp_path.unlink(missing_ok=True)
                return False

        # 移动到目标位置
        temp_path.rename(dest)
        logger.info("下载完成: %s (%.1f MB)", dest.name, dest.stat().st_size / 1024 / 1024)
        return True

    except Exception as e:
        logger.error("下载失败: %s - %s", url, e)
        temp_path.unlink(missing_ok=True)
        return False


async def ensure_models(settings: Settings | None = None) -> list[str]:
    """检查并下载缺失的必要模型

    Args:
        settings: 配置实例

    Returns:
        缺失且需要下载的模型文件名列表
    """
    if settings is None:
        settings = get_settings()

    missing: list[str] = []
    dirs = ensure_model_directories(settings)

    # 检查 checkpoints
    for name in DEFAULT_CHECKPOINT_DOWNLOADS:
        if not check_model_exists(name, dirs["checkpoints"]):
            missing.append(f"checkpoints/{name}")
            logger.warning("缺失模型: %s", name)

    # 检查 loras
    for name in DEFAULT_LORA_DOWNLOADS:
        if not check_model_exists(name, dirs["loras"]):
            missing.append(f"loras/{name}")
            logger.warning("缺失 LoRA: %s", name)

    if missing:
        logger.warning("共 %d 个模型文件缺失，首次运行时将自动下载", len(missing))
    else:
        logger.info("所有必要模型文件已就绪")

    return missing


def get_model_info(settings: Settings | None = None) -> dict[str, Any]:
    """获取当前模型文件状态信息

    Returns:
        各目录下的模型文件列表和状态
    """
    if settings is None:
        settings = get_settings()

    model_paths = settings.model_paths
    info: dict[str, Any] = {}

    for category, dir_path in [
        ("checkpoints", model_paths.checkpoints),
        ("loras", model_paths.loras),
        ("vae", model_paths.vae),
        ("controlnet", model_paths.controlnet),
    ]:
        path = Path(dir_path)
        if path.exists():
            files = [
                {"name": f.name, "size_mb": round(f.stat().st_size / 1024 / 1024, 1)}
                for f in path.iterdir()
                if f.suffix.lower() in {".safetensors", ".ckpt", ".pt", ".pth"}
            ]
        else:
            files = []
        info[category] = {"path": str(path), "files": files}

    return info
