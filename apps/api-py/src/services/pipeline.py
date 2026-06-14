"""SDXL 推理 Pipeline

参考 Fooocus modules/default_pipeline.py 实现完整的 diffusion 推理流程。
支持 Base + Refiner 双模型、LoRA 动态加载、ControlNet 等。

核心流程：
1. refresh_everything: 确保模型/LoRA/VAE 处于目标状态
2. clip_encode: 文本编码为 conditioning
3. process_diffusion: 执行扩散采样（支持 refiner swap）
4. vae_decode: 解码 latents 为图像
"""

import logging
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from src.services.async_worker import AsyncTask
from src.services.core import (
    StableDiffusionModel,
    get_base_model,
    get_refiner_model,
    load_model,
    refresh_loras,
)

logger = logging.getLogger(__name__)


class RefinerSwapMethod(str, Enum):
    """Refiner 切换方式（参考 Fooocus）"""

    JOINT = "joint"  # Base 和 Refiner 联合采样
    SEPARATE = "separate"  # 先 Base 后 Refiner 分离采样
    VAE = "vae"  # 通过 VAE 中间解码再编码切换


class Performance(str, Enum):
    """性能模式"""

    SPEED = "Speed"
    QUALITY = "Quality"
    EXTREME_SPEED = "Extreme Speed"


@dataclass
class DiffusionParams:
    """扩散采样参数"""

    prompt: str = ""
    negative_prompt: str = ""
    style_selections: list[str] = field(default_factory=list)
    steps: int = 30
    cfg_scale: float = 4.0
    sampler: str = "dpmpp_2m_sde_gpu"
    scheduler: str = "karras"
    width: int = 1024
    height: int = 1024
    seed: int = -1  # -1 表示随机
    performance: Performance = Performance.SPEED
    base_model: str = ""
    refiner_model: str = "None"
    refiner_switch: float = 0.8  # 在总步数的 80% 处切换到 Refiner
    refiner_swap_method: RefinerSwapMethod = RefinerSwapMethod.JOINT
    loras: list[tuple[str, float]] = field(default_factory=list)
    # ControlNet
    controlnet_model: str | None = None
    controlnet_image: str | None = None
    controlnet_weight: float = 1.0
    # Fooocus 增强参数
    sharpness: float = 2.0
    freeu_enabled: bool = True
    freeu_b1: float = 1.01
    freeu_b2: float = 1.02
    freeu_s1: float = 0.99
    freeu_s2: float = 0.95
    adm_guidance_positive: float = 1.5
    adm_guidance_negative: float = 0.8
    adm_guidance_end: float = 0.3

    def resolve_seed(self) -> int:
        """解析种子值（-1 时随机生成）"""
        if self.seed < 0:
            return random.randint(0, 2**31 - 1)
        return self.seed


@dataclass
class PipelineResult:
    """Pipeline 执行结果"""

    images: list[Any] = field(default_factory=list)  # PIL Image list
    seed: int = 0
    params: DiffusionParams | None = None
    elapsed_seconds: float = 0.0


class ImagePipeline:
    """图像生成 Pipeline

    封装完整的 SDXL 推理流程，参考 Fooocus default_pipeline。

    使用方式：
    ```python
    pipeline = ImagePipeline()
    pipeline.refresh_everything(params)
    result = pipeline.generate(params, task)
    ```
    """

    def __init__(self) -> None:
        self.model_base: StableDiffusionModel = get_base_model()
        self.model_refiner: StableDiffusionModel = get_refiner_model()
        self.loaded_controlnets: dict[str, Any] = {}
        self.final_expansion: Any = None  # FooocusExpansion GPT-2 模型

    def refresh_everything(self, params: DiffusionParams) -> None:
        """确保所有模型/LoRA/VAE 处于目标状态

        对比当前状态和目标参数，仅在需要时重新加载：
        - 基础模型变化时重新加载 Base
        - Refiner 变化时重新加载 Refiner
        - LoRA 变化时增量刷新
        """
        # 检查并加载 Base 模型
        if self.model_base.filename != params.base_model and params.base_model:
            logger.info("切换 Base 模型: %s -> %s", self.model_base.filename, params.base_model)
            self.model_base = load_model(params.base_model)

        # 检查并加载 Refiner 模型
        if params.refiner_model and params.refiner_model != "None":
            if self.model_refiner.filename != params.refiner_model:
                logger.info("切换 Refiner 模型: %s", params.refiner_model)
                self.model_refiner = load_model(params.refiner_model)
        else:
            if self.model_refiner.is_loaded:
                self.model_refiner.unload()

        # 刷新 LoRA
        if params.loras:
            refresh_loras(self.model_base, params.loras)

    def clip_encode(
        self,
        texts: list[str],
        pool_top_k: int = 1,
    ) -> Any:
        """文本编码为 CLIP conditioning

        Args:
            texts: 文本列表（正向/负向提示词）
            pool_top_k: CLIP pooling top-k

        Returns:
            CLIP conditioning 张量
        """
        # TODO: 实际 CLIP 编码逻辑
        logger.debug("CLIP 编码: %d 条文本", len(texts))
        return None

    def process_diffusion(
        self,
        positive_cond: Any,
        negative_cond: Any,
        params: DiffusionParams,
        task: AsyncTask | None = None,
        callback: Any = None,
    ) -> Any:
        """执行扩散采样

        参考 Fooocus process_diffusion 实现三种 Refiner swap 方式：
        - joint: Base 和 Refiner 在同一采样过程中联合处理
        - separate: 先用 Base 采样到 switch point，再用 Refiner 继续
        - vae: Base 采样完后 VAE 解码再编码，用 Refiner img2img

        Args:
            positive_cond: 正向条件
            negative_cond: 负向条件
            params: 采样参数
            task: 异步任务（用于推送进度和检查取消）
            callback: 采样步骤回调

        Returns:
            生成的 latent 张量
        """
        seed = params.resolve_seed()
        logger.info(
            "开始采样: %dx%d, steps=%d, cfg=%.1f, seed=%d, sampler=%s",
            params.width,
            params.height,
            params.steps,
            params.cfg_scale,
            seed,
            params.sampler,
        )

        # TODO: 实际采样逻辑（需要 ldm_patched KSampler）
        # 此处模拟采样过程以验证 pipeline 流程
        total_steps = params.steps
        for step in range(total_steps):
            if task and task.is_cancelled:
                logger.info("采样被用户取消 (step %d/%d)", step, total_steps)
                return None

            # 推送进度
            progress = int((step + 1) / total_steps * 80) + 10  # 10-90% 区间
            if task:
                task.push_progress(progress, f"采样中 {step + 1}/{total_steps}")

            # 模拟计算时间（实际推理中由 GPU 处理）
            time.sleep(0.01)

        return {"latent": "placeholder", "seed": seed}

    def vae_decode(self, latent: Any) -> Any:
        """VAE 解码 latents 为图像

        Args:
            latent: 编码的 latent 张量

        Returns:
            PIL Image 对象
        """
        # TODO: 实际 VAE 解码逻辑
        logger.debug("VAE 解码")
        return None

    def generate(
        self,
        params: DiffusionParams,
        task: AsyncTask | None = None,
    ) -> PipelineResult:
        """完整的图像生成流程

        执行顺序：
        1. refresh_everything - 确保模型就绪
        2. clip_encode - 文本编码
        3. process_diffusion - 扩散采样
        4. vae_decode - 解码为图像

        Args:
            params: 生成参数
            task: 异步任务实例

        Returns:
            PipelineResult 包含生成的图像和元数据
        """
        start_time = time.time()
        seed = params.resolve_seed()

        if task:
            task.push_progress(5, "准备模型...")

        # 1. 确保模型就绪
        try:
            self.refresh_everything(params)
        except FileNotFoundError as e:
            if task:
                task.fail(f"模型加载失败: {e}")
            return PipelineResult(seed=seed, params=params)

        if task and task.is_cancelled:
            return PipelineResult(seed=seed, params=params)

        if task:
            task.push_progress(10, "编码提示词...")

        # 2. CLIP 编码
        positive_cond = self.clip_encode([params.prompt])
        negative_cond = self.clip_encode([params.negative_prompt])

        if task and task.is_cancelled:
            return PipelineResult(seed=seed, params=params)

        # 3. 扩散采样
        latent = self.process_diffusion(
            positive_cond=positive_cond,
            negative_cond=negative_cond,
            params=params,
            task=task,
        )

        if latent is None or (task and task.is_cancelled):
            return PipelineResult(seed=seed, params=params)

        if task:
            task.push_progress(92, "解码图像...")

        # 4. VAE 解码
        image = self.vae_decode(latent)

        elapsed = time.time() - start_time
        logger.info("生成完成: seed=%d, 耗时=%.2fs", seed, elapsed)

        if task:
            task.push_progress(100, "完成")

        return PipelineResult(
            images=[image] if image else [],
            seed=seed,
            params=params,
            elapsed_seconds=elapsed,
        )


# 全局 Pipeline 实例
_pipeline: ImagePipeline | None = None


def get_pipeline() -> ImagePipeline:
    """获取全局 Pipeline 单例"""
    global _pipeline
    if _pipeline is None:
        _pipeline = ImagePipeline()
    return _pipeline
