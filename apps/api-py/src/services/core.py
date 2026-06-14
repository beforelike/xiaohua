"""模型加载与管理

参考 Fooocus modules/core.py 实现 SDXL 模型的加载、管理和 LoRA 热切换。
本模块提供统一的模型抽象层，隔离底层推理引擎（ldm_patched/ComfyUI）的复杂性。

注意：实际的 PyTorch 推理需要安装 [inference] 依赖组。
未安装时模块仍可导入但调用推理功能会抛出 ImportError 提示。
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class InferenceNotAvailableError(RuntimeError):
    """推理依赖未安装时抛出"""

    def __init__(self) -> None:
        super().__init__(
            "推理依赖未安装。请安装: pip install -e '.[inference]'\n"
            "需要 PyTorch、safetensors、transformers 等包。"
        )


def _check_inference_deps() -> None:
    """检查推理依赖是否可用"""
    try:
        import safetensors  # noqa: F401
        import torch  # noqa: F401
    except ImportError as e:
        raise InferenceNotAvailableError() from e


@dataclass
class StableDiffusionModel:
    """SDXL 模型容器

    封装 Base/Refiner 模型的核心组件，参考 Fooocus 设计：
    - unet: U-Net 去噪网络（可包含 LoRA 补丁）
    - vae: 变分自编码器
    - clip/clip_vision: 文本/视觉编码器

    Attributes:
        filename: 模型文件名
        unet: U-Net model patcher（动态 LoRA 应用层）
        vae: VAE 模型
        clip: CLIP 文本编码器
        clip_vision: CLIP 视觉编码器（用于 ControlNet/IP-Adapter）
        loras_loaded: 当前已加载的 LoRA 列表 [(filename, weight), ...]
    """

    filename: str | None = None
    unet: Any = None  # ModelPatcher from ldm_patched
    vae: Any = None  # VAE model
    clip: Any = None  # CLIP model
    clip_vision: Any = None  # CLIPVision model
    loras_loaded: list[tuple[str, float]] = field(default_factory=list)

    @property
    def is_loaded(self) -> bool:
        """模型是否已加载"""
        return self.unet is not None

    def unload(self) -> None:
        """卸载模型释放显存"""
        self.unet = None
        self.vae = None
        self.clip = None
        self.clip_vision = None
        self.loras_loaded.clear()
        logger.info("模型已卸载: %s", self.filename)


# 全局模型状态
_model_base = StableDiffusionModel()
_model_refiner = StableDiffusionModel()


def get_base_model() -> StableDiffusionModel:
    """获取当前 Base 模型"""
    return _model_base


def get_refiner_model() -> StableDiffusionModel:
    """获取当前 Refiner 模型"""
    return _model_refiner


def load_model(
    ckpt_filename: str,
    model_dir: str | Path = "./models/checkpoints",
    vae_filename: str | None = None,
    vae_dir: str | Path = "./models/vae",
) -> StableDiffusionModel:
    """加载 SDXL 模型

    参考 Fooocus load_model 流程：
    1. 从 safetensors/ckpt 文件加载权重
    2. 创建 ModelPatcher 封装 U-Net（用于 LoRA 动态加载）
    3. 加载 CLIP 文本编码器
    4. 加载 VAE（可选用独立 VAE 文件）

    Args:
        ckpt_filename: 模型文件名（如 juggernautXL_v8.safetensors）
        model_dir: 模型文件目录
        vae_filename: 可选独立 VAE 文件名
        vae_dir: VAE 文件目录

    Returns:
        加载好的 StableDiffusionModel

    Raises:
        InferenceNotAvailableError: 推理依赖未安装
        FileNotFoundError: 模型文件不存在
    """
    _check_inference_deps()

    model_path = Path(model_dir) / ckpt_filename
    if not model_path.exists():
        raise FileNotFoundError(f"模型文件不存在: {model_path}")

    logger.info("加载模型: %s", ckpt_filename)

    # TODO: 实际模型加载逻辑（需要 ldm_patched 引擎）
    # 此处定义接口，实际实现将集成 Fooocus 的加载器
    global _model_base
    _model_base = StableDiffusionModel(filename=ckpt_filename)

    logger.info("模型加载完成: %s", ckpt_filename)
    return _model_base


def refresh_loras(
    model: StableDiffusionModel,
    loras: list[tuple[str, float]],
    lora_dir: str | Path = "./models/loras",
) -> StableDiffusionModel:
    """刷新 LoRA 加载状态

    对比当前已加载的 LoRA 和目标列表，增量应用变更。
    参考 Fooocus 的 LoRA 动态切换机制：
    - 卸载不再需要的 LoRA
    - 加载新增的 LoRA
    - 调整权重变化的 LoRA

    Args:
        model: 目标模型
        loras: 目标 LoRA 列表 [(filename, weight), ...]
        lora_dir: LoRA 文件目录

    Returns:
        更新后的模型
    """
    if not model.is_loaded:
        logger.warning("模型未加载，跳过 LoRA 刷新")
        return model

    # 对比当前和目标 LoRA 列表
    current_set = set(model.loras_loaded)
    target_set = set(loras)

    if current_set == target_set:
        logger.debug("LoRA 状态无变化，跳过刷新")
        return model

    # TODO: 实际 LoRA 加载/卸载逻辑
    logger.info("刷新 LoRA: %s", [f"{name}:{weight}" for name, weight in loras])
    model.loras_loaded = list(loras)

    return model


def load_controlnet(
    ckpt_filename: str,
    controlnet_dir: str | Path = "./models/controlnet",
) -> Any:
    """加载 ControlNet 模型

    Args:
        ckpt_filename: ControlNet 模型文件名
        controlnet_dir: ControlNet 模型目录

    Returns:
        ControlNet 模型对象

    Raises:
        InferenceNotAvailableError: 推理依赖未安装
        FileNotFoundError: 模型文件不存在
    """
    _check_inference_deps()

    model_path = Path(controlnet_dir) / ckpt_filename
    if not model_path.exists():
        raise FileNotFoundError(f"ControlNet 文件不存在: {model_path}")

    logger.info("加载 ControlNet: %s", ckpt_filename)
    # TODO: 实际加载逻辑
    return None


def get_available_models(model_dir: str | Path = "./models/checkpoints") -> list[str]:
    """列出可用的模型文件

    Args:
        model_dir: 模型目录

    Returns:
        模型文件名列表
    """
    dir_path = Path(model_dir)
    if not dir_path.exists():
        return []

    extensions = {".safetensors", ".ckpt", ".pt"}
    return sorted(f.name for f in dir_path.iterdir() if f.suffix.lower() in extensions)


def get_available_loras(lora_dir: str | Path = "./models/loras") -> list[str]:
    """列出可用的 LoRA 文件

    Args:
        lora_dir: LoRA 目录

    Returns:
        LoRA 文件名列表
    """
    dir_path = Path(lora_dir)
    if not dir_path.exists():
        return []

    extensions = {".safetensors", ".ckpt", ".pt"}
    return sorted(f.name for f in dir_path.iterdir() if f.suffix.lower() in extensions)
