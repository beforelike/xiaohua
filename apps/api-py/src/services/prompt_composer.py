"""提示词组合与扩展

参考 Fooocus 的 prompt expansion 和 style 系统，实现：
- 正/负向提示词组合
- Quality tags 注入
- Generation profiles（风格模板）
- GPT-2 prompt expansion（本地运行）
"""

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# 质量标签 - 正向
QUALITY_TAGS_POSITIVE = [
    "best quality",
    "masterpiece",
    "highly detailed",
    "ultra-detailed",
    "highres",
]

# 质量标签 - 负向
QUALITY_TAGS_NEGATIVE = [
    "worst quality",
    "low quality",
    "normal quality",
    "lowres",
    "bad anatomy",
    "bad hands",
    "text",
    "error",
    "missing fingers",
    "extra digit",
    "fewer digits",
    "cropped",
    "jpeg artifacts",
    "signature",
    "watermark",
    "username",
    "blurry",
]

# Fooocus V2 风格模板
STYLE_TEMPLATES: dict[str, dict[str, str]] = {
    "Fooocus V2": {
        "positive": "{prompt}, cinematic, dramatic lighting, detailed textures",
        "negative": "deformed, ugly, disfigured, low quality, blurry",
    },
    "Fooocus Enhance": {
        "positive": "{prompt}, high quality, 4k, sharp focus",
        "negative": "blurry, out of focus, low resolution",
    },
    "Fooocus Photograph": {
        "positive": "{prompt}, photograph, professional photography, natural lighting, 35mm",
        "negative": "painting, illustration, drawing, anime, cartoon",
    },
    "SAI Anime": {
        "positive": "{prompt}, anime style, anime artwork, studio quality, vibrant colors",
        "negative": "realistic, photographic, 3d render, western cartoon",
    },
    "SAI Digital Art": {
        "positive": "{prompt}, digital art, concept art, trending on artstation, highly detailed",
        "negative": "photograph, realistic, lowres, blurry",
    },
    "SAI Fantasy Art": {
        "positive": "{prompt}, fantasy art, ethereal, magical, detailed environment",
        "negative": "modern, urban, realistic, photograph",
    },
}


@dataclass
class ComposedPrompt:
    """组合后的提示词结果"""

    positive: str = ""
    negative: str = ""
    styles_applied: list[str] = field(default_factory=list)


def apply_style_template(
    prompt: str,
    negative_prompt: str,
    style_name: str,
) -> tuple[str, str]:
    """应用风格模板

    Args:
        prompt: 原始正向提示词
        negative_prompt: 原始负向提示词
        style_name: 风格名称

    Returns:
        (styled_positive, styled_negative) 应用风格后的提示词对
    """
    template = STYLE_TEMPLATES.get(style_name)
    if template is None:
        logger.warning("未知风格模板: %s", style_name)
        return prompt, negative_prompt

    styled_positive = template["positive"].replace("{prompt}", prompt)
    styled_negative = (
        f"{negative_prompt}, {template['negative']}" if negative_prompt else template["negative"]
    )

    return styled_positive, styled_negative


def compose_prompt(
    prompt: str,
    negative_prompt: str = "",
    styles: list[str] | None = None,
    add_quality_tags: bool = True,
    global_style: str = "",
) -> ComposedPrompt:
    """组合完整的提示词

    组合顺序：
    1. 注入 global_style（如果有）
    2. 应用风格模板
    3. 添加质量标签

    Args:
        prompt: 用户提供的核心提示词
        negative_prompt: 用户提供的负向提示词
        styles: 要应用的风格模板名称列表
        add_quality_tags: 是否添加质量标签
        global_style: 全局画风描述

    Returns:
        ComposedPrompt 组合结果
    """
    result = ComposedPrompt()

    # 合并 global style
    working_prompt = prompt
    if global_style:
        working_prompt = f"{prompt}, {global_style}"

    working_negative = negative_prompt

    # 应用风格模板
    applied_styles: list[str] = []
    if styles:
        for style_name in styles:
            working_prompt, working_negative = apply_style_template(
                working_prompt, working_negative, style_name
            )
            if style_name in STYLE_TEMPLATES:
                applied_styles.append(style_name)

    # 添加质量标签
    if add_quality_tags:
        quality_pos = ", ".join(QUALITY_TAGS_POSITIVE)
        quality_neg = ", ".join(QUALITY_TAGS_NEGATIVE)
        working_prompt = f"{working_prompt}, {quality_pos}"
        working_negative = f"{working_negative}, {quality_neg}" if working_negative else quality_neg

    result.positive = working_prompt.strip(", ")
    result.negative = working_negative.strip(", ")
    result.styles_applied = applied_styles

    return result


def parse_inline_loras(prompt: str) -> tuple[str, list[tuple[str, float]]]:
    """解析内联 LoRA 语法

    支持 Fooocus 风格的内联 LoRA 语法：
    `<lora:filename:weight>`

    Args:
        prompt: 包含内联 LoRA 标记的提示词

    Returns:
        (clean_prompt, loras) 清理后的提示词和解析出的 LoRA 列表
    """
    import re

    loras: list[tuple[str, float]] = []
    pattern = r"<lora:([^:>]+):([0-9.]+)>"

    for match in re.finditer(pattern, prompt):
        filename = match.group(1)
        weight = float(match.group(2))
        # 确保文件名有扩展名
        if not filename.endswith(".safetensors"):
            filename = f"{filename}.safetensors"
        loras.append((filename, weight))

    clean_prompt = re.sub(pattern, "", prompt).strip(", ").strip()
    return clean_prompt, loras


def expand_wildcards(prompt: str, wildcard_dir: str | None = None) -> str:
    """展开通配符

    支持 `__wildcard_name__` 语法，从对应文本文件中随机选择一行替换。

    Args:
        prompt: 包含通配符标记的提示词
        wildcard_dir: 通配符文件目录

    Returns:
        展开后的提示词
    """
    import random
    import re
    from pathlib import Path

    if wildcard_dir is None:
        return prompt  # 无通配符目录，原样返回

    pattern = r"__([a-zA-Z0-9_-]+)__"

    def replace_wildcard(match: re.Match) -> str:  # type: ignore[type-arg]
        name = match.group(1)
        wildcard_file = Path(wildcard_dir) / f"{name}.txt"
        if not wildcard_file.exists():
            logger.warning("通配符文件不存在: %s", wildcard_file)
            return match.group(0)  # 保持原样

        lines = [
            line.strip()
            for line in wildcard_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if not lines:
            return ""
        return random.choice(lines)

    return re.sub(pattern, replace_wildcard, prompt)


def get_available_styles() -> list[str]:
    """获取所有可用的风格模板名称"""
    return sorted(STYLE_TEMPLATES.keys())
