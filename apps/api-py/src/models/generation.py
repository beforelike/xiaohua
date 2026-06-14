"""素材生成数据模型

对应 contracts 中的 GenerateAssetRequest/Response 等 schema。
"""

from enum import Enum

from pydantic import BaseModel, Field


class GenerationMode(str, Enum):
    """生成模式"""

    STANDARD = "standard"
    SCENE = "scene"
    CHARACTER_SHEET = "character-sheet"
    CHARACTER_ACTION = "character-action"


class BackgroundType(str, Enum):
    """背景类型"""

    TRANSPARENT = "transparent"
    OPAQUE = "opaque"


class MimeType(str, Enum):
    """输出 MIME 类型"""

    PNG = "image/png"
    SVG = "image/svg+xml"


class GenerationMetadata(BaseModel):
    """图像生成元数据"""

    provider: str = Field(default="local-sdxl", description="生成提供者")
    mode: str = Field(default="standard", description="生成模式")
    prompt: str = Field(max_length=8000, description="正向提示词")
    negative_prompt: str = Field(
        default="", max_length=8000, alias="negativePrompt", description="负向提示词"
    )
    style: str = Field(max_length=1000, description="画风")
    seed: int = Field(ge=0, description="随机种子")
    width: int = Field(gt=0, description="图像宽度")
    height: int = Field(gt=0, description="图像高度")
    steps: int = Field(ge=0, description="采样步数")
    cfg_scale: float = Field(ge=0, alias="cfgScale", description="CFG Scale")
    sampler: str = Field(max_length=120, description="采样器")
    pipeline_version: int = Field(gt=0, alias="pipelineVersion", description="Pipeline 版本")

    model_config = {"populate_by_name": True}


class GenerateAssetRequest(BaseModel):
    """素材生成请求"""

    schema_version: int = Field(default=1, alias="schemaVersion")
    command_id: str = Field(min_length=1, alias="commandId")
    prompt: str = Field(min_length=1, max_length=2000)
    negative_prompt: str | None = Field(default=None, max_length=2000, alias="negativePrompt")
    style: str | None = Field(default=None, max_length=500)
    width: int = Field(ge=256, le=1024)
    height: int = Field(ge=256, le=1024)
    background: BackgroundType
    enhanced_prompt: bool | None = Field(default=None, alias="enhancedPrompt")
    generation_mode: GenerationMode | None = Field(default=None, alias="generationMode")
    reference_asset_id: str | None = Field(default=None, alias="referenceAssetId")
    reference_weight: float | None = Field(default=None, ge=0.1, le=2, alias="referenceWeight")
    scene_context: str | None = Field(default=None, max_length=5000, alias="sceneContext")
    scene_image_data_url: str | None = Field(default=None, alias="sceneImageDataUrl")
    identity_constraints: str | None = Field(
        default=None, max_length=2000, alias="identityConstraints"
    )
    preserve_colors: bool | None = Field(default=None, alias="preserveColors")
    preserve_pose: bool | None = Field(default=None, alias="preservePose")

    model_config = {"populate_by_name": True}


class GeneratedAsset(BaseModel):
    """生成的素材"""

    id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    mime_type: MimeType = Field(alias="mimeType")
    background_removed: bool = Field(alias="backgroundRemoved")
    source: str = Field(default="generated")
    generation: GenerationMetadata | None = None

    model_config = {"populate_by_name": True}


class GenerateAssetResponse(BaseModel):
    """素材生成响应"""

    asset: GeneratedAsset


class TaskStatus(str, Enum):
    """异步任务状态"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskSubmitResponse(BaseModel):
    """任务提交响应"""

    task_id: str = Field(alias="taskId", description="任务 ID")

    model_config = {"populate_by_name": True}


class TaskStatusResponse(BaseModel):
    """任务状态查询响应"""

    task_id: str = Field(alias="taskId")
    status: TaskStatus
    progress: int = Field(ge=0, le=100, description="进度百分比")
    result: GenerateAssetResponse | None = None
    error: str | None = None

    model_config = {"populate_by_name": True}
