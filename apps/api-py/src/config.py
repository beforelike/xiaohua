"""应用配置管理

实现配置优先级链（从高到低）：
  CLI args > 环境变量 > config.json > presets/{name}.json > 硬编码默认值

参考 Fooocus modules/config.py 的多层配置设计。
"""

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)

# 默认配置文件搜索路径
_CONFIG_SEARCH_PATHS = [
    Path("config.json"),
    Path.home() / ".xiaohua" / "config.json",
]


class ModelPaths(BaseSettings):
    """模型文件路径配置"""

    checkpoints: str = Field(default="./models/checkpoints", description="SDXL 基础模型目录")
    loras: str = Field(default="./models/loras", description="LoRA 模型目录")
    vae: str = Field(default="./models/vae", description="VAE 模型目录")
    controlnet: str = Field(default="./models/controlnet", description="ControlNet 模型目录")
    inpaint: str = Field(default="./models/inpaint", description="Inpaint 模型目录")
    vae_approx: str = Field(default="./models/vae_approx", description="预览 VAE 目录")
    prompt_expansion: str = Field(
        default="./models/prompt_expansion", description="GPT-2 expansion 模型目录"
    )

    model_config = {"extra": "ignore"}


class Settings(BaseSettings):
    """应用全局配置

    使用 Pydantic Settings 自动从环境变量加载配置。
    环境变量前缀: XIAOHUA_
    """

    # 服务配置
    host: str = Field(default="0.0.0.0", description="监听地址")
    port: int = Field(default=8000, description="监听端口")
    debug: bool = Field(default=False, description="调试模式")

    # CORS
    cors_origins: list[str] = Field(
        default=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        description="允许的跨域来源",
    )

    # 模型路径
    model_base_path: str = Field(
        default="./models",
        description="模型文件根目录",
    )
    model_paths: ModelPaths = Field(default_factory=ModelPaths, description="分类模型路径")

    # 预设
    preset: str = Field(default="default", description="当前使用的预设名称")

    # 生成配置默认值
    default_model: str = Field(
        default="juggernautXL_v8Rundiffusion.safetensors", description="默认基础模型"
    )
    default_refiner: str = Field(default="None", description="默认 Refiner 模型")
    default_loras: list[list[Any]] = Field(
        default_factory=lambda: [["sd_xl_offset_example-lora_1.0.safetensors", 0.1]],
        description="默认 LoRA 列表 [[filename, weight], ...]",
    )
    default_steps: int = Field(default=30, description="默认采样步数")
    default_cfg_scale: float = Field(default=4.0, description="默认 CFG Scale")
    default_sampler: str = Field(default="dpmpp_2m_sde_gpu", description="默认采样器")
    default_scheduler: str = Field(default="karras", description="默认调度器")
    default_width: int = Field(default=1024, description="默认图像宽度")
    default_height: int = Field(default=1024, description="默认图像高度")
    default_performance: str = Field(default="Speed", description="默认性能模式")
    default_styles: list[str] = Field(
        default_factory=lambda: ["Fooocus V2", "Fooocus Enhance"],
        description="默认风格列表",
    )

    # ASR 配置
    asr_provider: str = Field(default="paraformer", description="ASR 引擎")
    asr_endpoint: str = Field(default="http://localhost:10095", description="ASR 服务地址")

    # 输出目录
    output_dir: str = Field(default="./outputs", description="生成图片输出目录")

    model_config = {
        "env_prefix": "XIAOHUA_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


def load_json_file(file_path: Path) -> dict[str, Any]:
    """安全加载 JSON 文件

    Args:
        file_path: JSON 文件路径

    Returns:
        解析后的字典，文件不存在或解析失败时返回空字典
    """
    if not file_path.exists():
        return {}
    try:
        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning("配置文件 %s 根节点不是对象，已忽略", file_path)
            return {}
        return data
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("加载配置文件 %s 失败: %s", file_path, e)
        return {}


def load_preset(preset_name: str, presets_dir: Path | None = None) -> dict[str, Any]:
    """加载指定预设文件

    Args:
        preset_name: 预设名称（不含 .json 后缀）
        presets_dir: 预设文件目录，默认为 src/presets/

    Returns:
        预设配置字典，文件不存在时返回空字典
    """
    if presets_dir is None:
        presets_dir = Path(__file__).parent / "presets"

    return load_json_file(presets_dir / f"{preset_name}.json")


def load_config_json() -> dict[str, Any]:
    """加载 config.json 用户配置

    按以下顺序搜索 config.json：
    1. 当前工作目录
    2. ~/.xiaohua/config.json

    Returns:
        首个找到的 config.json 内容，均不存在时返回空字典
    """
    for search_path in _CONFIG_SEARCH_PATHS:
        data = load_json_file(search_path)
        if data:
            logger.info("已加载用户配置: %s", search_path)
            return data
    return {}


def list_presets(presets_dir: Path | None = None) -> list[str]:
    """列出所有可用的预设名称

    Args:
        presets_dir: 预设文件目录

    Returns:
        预设名称列表（不含 .json 后缀）
    """
    if presets_dir is None:
        presets_dir = Path(__file__).parent / "presets"

    if not presets_dir.exists():
        return []

    return sorted(p.stem for p in presets_dir.glob("*.json"))


def build_settings(cli_overrides: dict[str, Any] | None = None) -> Settings:
    """构建完整配置，按优先级合并所有配置源

    配置优先级（从高到低）：
    1. CLI 参数（cli_overrides）
    2. 环境变量（XIAOHUA_ 前缀，由 Pydantic Settings 自动处理）
    3. config.json（用户自定义配置文件）
    4. presets/{name}.json（预设配置）
    5. 硬编码默认值（Settings 字段默认值）

    Args:
        cli_overrides: CLI 参数覆盖字典（仅包含用户显式指定的参数）

    Returns:
        合并后的 Settings 实例
    """
    cli_overrides = cli_overrides or {}

    # 确定预设名称（CLI > env > 默认 "default"）
    preset_name = cli_overrides.get("preset", None)
    if preset_name is None:
        import os

        preset_name = os.environ.get("XIAOHUA_PRESET", "default")

    # 按优先级从低到高合并
    # 4. 预设默认值
    preset_data = load_preset(preset_name)

    # 3. config.json
    config_data = load_config_json()

    # 合并：preset < config.json < (env 由 Pydantic 自动处理) < CLI
    merged: dict[str, Any] = {}
    merged.update(preset_data)
    merged.update(config_data)
    merged.update(cli_overrides)

    # 处理 model_paths 嵌套配置
    if "model_paths" in merged and isinstance(merged["model_paths"], dict):
        merged["model_paths"] = ModelPaths(**merged["model_paths"])

    return Settings(**merged)


@lru_cache
def get_settings() -> Settings:
    """获取全局配置单例（带缓存）

    使用默认配置加载流程（不含 CLI 参数）。
    若需要 CLI 参数支持，应在 main 启动时调用 build_settings()。
    """
    return build_settings()
