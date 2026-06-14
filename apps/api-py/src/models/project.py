"""项目数据模型

对应 contracts 中的 Project、Layer、CanvasSettings 等 schema。
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class LayerType(str, Enum):
    """图层类型"""

    IMAGE = "image"
    TEXT = "text"
    SHAPE = "shape"
    PRESET = "preset"


class AssetStatus(str, Enum):
    """素材状态"""

    READY = "ready"
    GENERATING = "generating"
    FAILED = "failed"


class LayerSource(str, Enum):
    """图层来源"""

    GENERATED = "generated"
    PRESET = "preset"
    USER = "user"


class CreatedBy(str, Enum):
    """创建方式"""

    VOICE = "voice"
    SYSTEM = "system"


class CanvasSettings(BaseModel):
    """画布设置"""

    width: int = Field(gt=0, description="画布宽度")
    height: int = Field(gt=0, description="画布高度")
    background_color: str = Field(
        min_length=1, alias="backgroundColor", description="背景颜色"
    )

    model_config = {"populate_by_name": True}


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
    pipeline_version: int = Field(
        gt=0, alias="pipelineVersion", description="Pipeline 版本"
    )

    model_config = {"populate_by_name": True}


class Layer(BaseModel):
    """图层"""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=80)
    type: LayerType
    asset_url: str | None = Field(default=None, alias="assetUrl")
    prompt: str | None = Field(default=None, max_length=2000)
    negative_prompt: str | None = Field(
        default=None, max_length=2000, alias="negativePrompt"
    )
    semantic_description: str | None = Field(
        default=None, max_length=2000, alias="semanticDescription"
    )
    generation: GenerationMetadata | None = None
    character_asset_id: str | None = Field(
        default=None, alias="characterAssetId"
    )
    group_id: str | None = Field(default=None, alias="groupId")
    parent_layer_id: str | None = Field(default=None, alias="parentLayerId")
    relation: str | None = Field(default=None, max_length=200)
    text_content: str | None = Field(
        default=None, max_length=500, alias="textContent"
    )
    font_family: str | None = Field(
        default=None, max_length=120, alias="fontFamily"
    )
    font_size: float | None = Field(default=None, gt=0, le=512, alias="fontSize")
    font_weight: str | None = Field(default=None, alias="fontWeight")
    fill: str | None = Field(default=None, max_length=80)
    align: str | None = None
    stroke: str | None = Field(default=None, max_length=80)
    stroke_width: float | None = Field(
        default=None, ge=0, le=32, alias="strokeWidth"
    )
    source: LayerSource
    status: AssetStatus
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: float
    opacity: float = Field(ge=0, le=1)
    visible: bool
    locked: bool
    z_index: int = Field(ge=0, alias="zIndex")
    created_by: CreatedBy = Field(alias="createdBy")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class CharacterAsset(BaseModel):
    """角色素材"""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=80)
    identity_prompt: str = Field(
        min_length=1, max_length=2000, alias="identityPrompt"
    )
    turnaround_asset_id: str | None = Field(
        default=None, alias="turnaroundAssetId"
    )
    turnaround_asset_url: str | None = Field(
        default=None, alias="turnaroundAssetUrl"
    )
    reference_asset_id: str = Field(min_length=1, alias="referenceAssetId")
    reference_asset_url: str = Field(min_length=1, alias="referenceAssetUrl")
    style: str = Field(max_length=500)
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class ProjectMemory(BaseModel):
    """项目记忆"""

    creative_direction: str = Field(
        default="", max_length=1000, alias="creativeDirection"
    )
    scene_summary: str = Field(default="", max_length=2000, alias="sceneSummary")
    palette: list[str] = Field(default_factory=list, max_length=12)
    lighting: str = Field(default="", max_length=500)
    recent_intents: list[str] = Field(
        default_factory=list, max_length=20, alias="recentIntents"
    )

    model_config = {"populate_by_name": True}


class Project(BaseModel):
    """项目"""

    schema_version: int = Field(default=1, alias="schemaVersion")
    id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=120)
    canvas: CanvasSettings
    global_style: str = Field(max_length=500, alias="globalStyle")
    memory: ProjectMemory = Field(default_factory=ProjectMemory)
    character_assets: list[CharacterAsset] = Field(
        default_factory=list, alias="characterAssets"
    )
    layers: list[Layer]
    selected_layer_id: str | None = Field(default=None, alias="selectedLayerId")
    recent_layer_ids: list[str] = Field(
        default_factory=list, alias="recentLayerIds"
    )
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}
