"""命令数据模型

对应 contracts 中的 DrawingCommand、ParseCommandRequest、SceneObject 等 schema。
"""

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from src.models.project import CanvasSettings, LayerType


class CommandAction(str, Enum):
    """命令动作类型"""

    CREATE = "create"
    SELECT = "select"
    MODIFY = "modify"
    DELETE = "delete"
    DUPLICATE = "duplicate"
    GROUP = "group"
    UNGROUP = "ungroup"
    REORDER = "reorder"
    RENAME = "rename"
    UNDO = "undo"
    REDO = "redo"
    SAVE = "save"
    CONFIRM = "confirm"
    CANCEL = "cancel"


class Position(str, Enum):
    """对象在画布中的建议位置"""

    TOP_LEFT = "top-left"
    TOP = "top"
    TOP_RIGHT = "top-right"
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"
    BOTTOM_LEFT = "bottom-left"
    BOTTOM = "bottom"
    BOTTOM_RIGHT = "bottom-right"


class ObjectSize(str, Enum):
    """对象相对画布的建议尺寸"""

    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    FULL = "full"


class SceneObject(BaseModel):
    """场景对象"""

    name: str = Field(min_length=1, max_length=80, description="对象名称")
    prompt: str = Field(max_length=2000, description="LLM增强后的英文正向提示词")
    identity_prompt: str | None = Field(
        default=None, max_length=2000, alias="identityPrompt",
        description="不含动作和环境的稳定角色身份描述",
    )
    action_prompt: str | None = Field(
        default=None, max_length=2000, alias="actionPrompt",
        description="仅描述当前动作、姿态和朝向",
    )
    negative_prompt: str | None = Field(
        default=None, max_length=2000, alias="negativePrompt",
        description="LLM生成的英文负向提示词",
    )
    background: str = Field(description="背景类型：transparent 或 opaque")
    is_background: bool = Field(
        default=False, alias="isBackground", description="是否为场景背景层"
    )
    position: Position = Field(default=Position.CENTER, description="建议位置")
    size: ObjectSize = Field(default=ObjectSize.MEDIUM, description="建议尺寸")

    model_config = {"populate_by_name": True}


class CommandTarget(BaseModel):
    """命令目标"""

    id: str | None = Field(default=None, min_length=1)
    ids: list[str] | None = Field(default=None, min_length=2, max_length=20)
    name: str | None = Field(default=None, min_length=1)
    reference: str | None = None
    spatial_hint: str | None = Field(default=None, alias="spatialHint")

    model_config = {"populate_by_name": True}


class CommandProperties(BaseModel):
    """命令属性"""

    position: str | None = Field(default=None, max_length=80)
    size: str | None = Field(default=None, max_length=80)
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, gt=0)
    height: float | None = Field(default=None, gt=0)
    color: str | None = Field(default=None, max_length=80)
    text: str | None = Field(default=None, max_length=500)
    font_family: str | None = Field(
        default=None, max_length=120, alias="fontFamily"
    )
    font_size: float | None = Field(default=None, gt=0, le=512, alias="fontSize")
    font_weight: str | None = Field(default=None, alias="fontWeight")
    align: str | None = None
    stroke: str | None = Field(default=None, max_length=80)
    stroke_width: float | None = Field(
        default=None, ge=0, le=32, alias="strokeWidth"
    )
    rotation: float | None = None
    rotation_delta: float | None = Field(default=None, alias="rotationDelta")
    scale_delta: float | None = Field(default=None, alias="scaleDelta")
    opacity: float | None = Field(default=None, ge=0, le=1)
    opacity_delta: float | None = Field(
        default=None, ge=-1, le=1, alias="opacityDelta"
    )
    visible: bool | None = None
    locked: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=80)
    z_order: str | None = Field(default=None, alias="zOrder")

    model_config = {"populate_by_name": True}


class DrawingCommand(BaseModel):
    """绘画命令"""

    schema_version: int = Field(default=1, alias="schemaVersion")
    id: str = Field(min_length=1)
    action: CommandAction
    target: CommandTarget | None = None
    object_type: LayerType | None = Field(default=None, alias="objectType")
    prompt: str | None = Field(default=None, max_length=2000)
    style: str | None = Field(default=None, max_length=500)
    creative_direction: str | None = Field(
        default=None, max_length=1000, alias="creativeDirection"
    )
    scene_summary: str | None = Field(
        default=None, max_length=2000, alias="sceneSummary"
    )
    objects: list[SceneObject] | None = Field(default=None, max_length=10)
    properties: CommandProperties | None = None
    requires_generation: bool = Field(alias="requiresGeneration")
    confidence: float = Field(ge=0, le=1)

    model_config = {"populate_by_name": True}


class RecentLayerContext(BaseModel):
    """上下文中的最近图层信息"""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    type: LayerType
    prompt: str | None = Field(default=None, max_length=2000)
    semantic_description: str | None = Field(
        default=None, max_length=2000, alias="semanticDescription"
    )
    text_content: str | None = Field(
        default=None, max_length=500, alias="textContent"
    )
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, gt=0)
    height: float | None = Field(default=None, gt=0)
    rotation: float | None = None
    z_index: int | None = Field(default=None, ge=0, alias="zIndex")

    model_config = {"populate_by_name": True}


class ParseCommandContext(BaseModel):
    """命令解析上下文"""

    selected_layer_id: str | None = Field(alias="selectedLayerId")
    recent_layers: list[RecentLayerContext] = Field(
        max_length=20, alias="recentLayers"
    )
    global_style: str = Field(max_length=500, alias="globalStyle")
    creative_direction: str | None = Field(
        default=None, max_length=1000, alias="creativeDirection"
    )
    scene_summary: str | None = Field(
        default=None, max_length=2000, alias="sceneSummary"
    )
    canvas: CanvasSettings | None = None

    model_config = {"populate_by_name": True}


class ParseCommandRequest(BaseModel):
    """命令解析请求"""

    schema_version: int = Field(default=1, alias="schemaVersion")
    text: str = Field(min_length=1, max_length=500)
    context: ParseCommandContext

    model_config = {"populate_by_name": True}


class ClarificationReason(str, Enum):
    """触发澄清回环的原因"""

    LOW_CONFIDENCE = "low_confidence"  # 解析置信度过低，需用户确认
    AMBIGUOUS_TARGET = "ambiguous_target"  # 命中多个候选目标，需用户指定
    MISSING_TARGET = "missing_target"  # 缺少操作目标，需用户指定


class ClarificationOption(BaseModel):
    """澄清回环的候选项

    供前端在 confirming 阶段呈现给用户进行语音/点选确认。
    """

    id: str = Field(min_length=1, description="候选项标识，用户确认时回传")
    label: str = Field(min_length=1, max_length=120, description="中文展示文案")
    target_id: str | None = Field(
        default=None, alias="targetId", description="该候选项对应的图层 ID（目标歧义时使用）"
    )

    model_config = {"populate_by_name": True}


class ClarificationResult(BaseModel):
    """澄清回环结果

    当解析置信度不足或目标存在歧义时返回，前端据此进入 confirming 阶段，
    用中文向用户提问并收集确认，避免直接对画布执行错误操作。
    """

    kind: Literal["clarification"] = "clarification"
    reason: ClarificationReason
    question: str = Field(min_length=1, max_length=300, description="向用户提出的中文澄清问题")
    original_text: str = Field(alias="originalText", description="触发澄清的原始用户输入")
    options: list[ClarificationOption] = Field(
        default_factory=list, max_length=10, description="候选项列表"
    )
    candidate: DrawingCommand | None = Field(
        default=None, description="低置信度时的最佳猜测命令，供用户确认后直接执行"
    )

    model_config = {"populate_by_name": True}
