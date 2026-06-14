"""命令解析器

将用户自然语言输入解析为结构化绘画命令。
解析链路（受 settings.command_provider 控制）：
1. 极速规则路径：撤销/重做/保存/确认/取消等无歧义短指令，零延迟直接返回。
2. LLM 语义解析：理解复杂指令、拆解多对象、生成英文提示词、解析指代目标。
3. 规则回退：LLM 未配置或调用失败时，用关键词规则尽力解析，保证离线可用。

解析得到命令后统一进入后处理：
- 目标解析（指代消解）：把"它/那只猫"等解析到具体图层 ID。
- 置信度澄清回环：置信度不足或目标存在歧义时，返回 ClarificationResult 请用户确认，
  而非直接对画布执行可能错误的操作。
"""

import json
import logging
import re
import uuid
from typing import Any

from src.config import Settings, get_settings
from src.models.commands import (
    ClarificationOption,
    ClarificationReason,
    ClarificationResult,
    CommandAction,
    CommandTarget,
    DrawingCommand,
    ParseCommandContext,
    ParseCommandRequest,
    RecentLayerContext,
)
from src.services.llm_client import LLMClient, LLMError

logger = logging.getLogger(__name__)

# 规则解析 - 动作关键词映射
ACTION_KEYWORDS: dict[str, list[str]] = {
    "create": ["画", "添加", "创建", "加", "来个", "放", "生成", "新建"],
    "delete": ["删除", "移除", "去掉", "删掉", "移走"],
    "select": ["选择", "选中", "点", "切换到"],
    "modify": ["修改", "改", "调整", "变", "换", "改变", "设置"],
    "duplicate": ["复制", "克隆", "拷贝"],
    "undo": ["撤销", "撤回", "取消上一步"],
    "redo": ["重做", "恢复"],
    "save": ["保存", "存"],
    "group": ["分组", "编组"],
    "ungroup": ["取消分组", "解组"],
    "reorder": ["移到前面", "移到后面", "置顶", "置底", "上移", "下移"],
    "rename": ["重命名", "改名"],
}

# 极速路径：整句精确匹配（零歧义，无需目标与生成），用于压低高频确认类指令的延迟
FAST_PATH_PHRASES: dict[str, str] = {
    "撤销": "undo",
    "撤回": "undo",
    "上一步": "undo",
    "重做": "redo",
    "恢复": "redo",
    "保存": "save",
    "保存项目": "save",
    "存一下": "save",
    "确认": "confirm",
    "对": "confirm",
    "是的": "confirm",
    "好的": "confirm",
    "可以": "confirm",
    "没错": "confirm",
    "取消": "cancel",
    "不对": "cancel",
    "不是": "cancel",
    "算了": "cancel",
}

# 需要明确操作目标的动作
TARGET_REQUIRED_ACTIONS: set[CommandAction] = {
    CommandAction.MODIFY,
    CommandAction.DELETE,
    CommandAction.DUPLICATE,
    CommandAction.RENAME,
    CommandAction.REORDER,
    CommandAction.SELECT,
}


def _new_command_id() -> str:
    return str(uuid.uuid4())


def parse_fast_path(text: str) -> DrawingCommand | None:
    """极速规则路径：整句精确匹配高频无歧义指令

    Args:
        text: 用户输入文本

    Returns:
        命中时返回高置信度命令，否则 None
    """
    action = FAST_PATH_PHRASES.get(text.strip())
    if action is None:
        return None

    return DrawingCommand.model_validate(
        {
            "schemaVersion": 1,
            "id": _new_command_id(),
            "action": action,
            "requiresGeneration": False,
            "confidence": 1.0,
        }
    )


def parse_by_rules(text: str, context: dict[str, Any]) -> DrawingCommand | None:
    """基于规则的命令解析

    使用关键词匹配快速识别用户意图。规则解析速度快且无外部依赖。
    当文本同时命中多个不同动作（语义歧义）时返回 None，交由 LLM 处理，避免误判。

    Args:
        text: 用户输入文本
        context: 画布上下文信息

    Returns:
        解析出的命令，无法识别或存在歧义时返回 None
    """
    text_lower = text.strip()

    # 匹配所有命中的动作（用于歧义检测）
    matched_actions: list[str] = []
    for action, keywords in ACTION_KEYWORDS.items():
        if any(keyword in text_lower for keyword in keywords):
            matched_actions.append(action)

    if not matched_actions:
        return None

    # 命中多个不同动作，规则无法可靠判定，交给 LLM
    if len(matched_actions) > 1:
        logger.info("规则解析命中多个动作 %s，交由 LLM 处理: '%s'", matched_actions, text)
        return None

    matched_action = matched_actions[0]
    requires_generation = matched_action == "create"

    command_data: dict[str, Any] = {
        "schemaVersion": 1,
        "id": _new_command_id(),
        "action": matched_action,
        "requiresGeneration": requires_generation,
        "confidence": 0.7,  # 规则匹配置信度中等
    }

    # 对 create 动作提取 prompt（关键词后面的内容）
    if matched_action == "create":
        for keyword in ACTION_KEYWORDS["create"]:
            if keyword in text_lower:
                idx = text_lower.index(keyword) + len(keyword)
                remaining = text_lower[idx:].strip()
                remaining = re.sub(r"^(一个|一只|一棵|个|只|幅|张|把|条)", "", remaining)
                if remaining:
                    command_data["prompt"] = remaining
                break

    return DrawingCommand.model_validate(command_data)


# ===================== LLM 解析 =====================

_LLM_SYSTEM_PROMPT = """你是"笑画"——一个纯语音控制的本地分层绘画工具的指令解析引擎。
用户只能通过语音操作，你要把中文口语指令解析为严格的 JSON 命令对象。

输出要求（务必遵守）：
1. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
2. 字段 action 取值之一：create, select, modify, delete, duplicate, group, ungroup,
   reorder, rename, undo, redo, save, confirm, cancel。
3. 字段 requiresGeneration：仅当 action=create 且需要生成新图像时为 true，其余为 false。
4. 字段 confidence：0~1 的浮点数，表示你对本次解析的把握程度。口语模糊、信息不全时给低分（<0.6）。
5. 画图相关的 prompt / objects[].prompt / negativePrompt 一律用英文；name 用简短中文。

action=create 时：
- 简单单对象可只给 prompt。
- 复杂场景（含多个元素）必须拆解到 objects 数组（最多 10 个），每个元素含：
  name(中文名), prompt(英文正向词), identityPrompt(稳定身份，不含动作/环境),
  actionPrompt(仅动作姿态朝向), negativePrompt(英文负向词),
  background("transparent" 前景 / "opaque" 背景), isBackground(布尔),
  position(top-left/top/top-right/left/center/right/bottom-left/bottom/bottom-right),
  size(small/medium/large/full)。

涉及已有对象的操作（modify/delete/select/duplicate/rename/reorder）时，给出 target：
- 用户明确指代某对象时填 target.name（如"那只猫"→"猫"）。
- 用户说"它/这个/刚才那个"等指代当前选中或最近对象时填 target.reference（"selected" 或 "recent"）。
- 含方位信息（左边/右边的那个）时填 target.spatialHint（left/center/right/top/bottom）。

modify 的具体改动放入 properties，例如：放大→scaleDelta(正数)，缩小→scaleDelta(负数)，
旋转→rotationDelta，改颜色→color，移动→position 或 x/y，透明度→opacity/opacityDelta，
层级→zOrder(front/back/up/down)。

只输出 JSON。"""


def _build_user_prompt(text: str, context: ParseCommandContext) -> str:
    """构造给 LLM 的用户提示词，附带画布上下文以支持指代消解"""
    recent_layers = [
        {
            "id": layer.id,
            "name": layer.name,
            "type": layer.type.value if hasattr(layer.type, "value") else str(layer.type),
            "semanticDescription": layer.semantic_description,
            "textContent": layer.text_content,
        }
        for layer in context.recent_layers
    ]
    context_payload = {
        "selectedLayerId": context.selected_layer_id,
        "recentLayers": recent_layers,
        "globalStyle": context.global_style,
        "creativeDirection": context.creative_direction,
        "sceneSummary": context.scene_summary,
    }
    return (
        f"用户语音指令：{text}\n\n"
        f"当前画布上下文（用于指代消解，可为空）：\n"
        f"{json.dumps(context_payload, ensure_ascii=False)}"
    )


def _command_from_llm(raw: dict[str, Any], text: str) -> DrawingCommand:
    """将 LLM 返回的 JSON 规整为合法 DrawingCommand"""
    data = dict(raw)
    data["schemaVersion"] = 1
    data.setdefault("id", _new_command_id())
    # 兜底必填项，避免个别模型遗漏导致整体失败
    data.setdefault("confidence", 0.5)
    if "requiresGeneration" not in data and "requires_generation" not in data:
        data["requiresGeneration"] = data.get("action") == "create"

    try:
        return DrawingCommand.model_validate(data)
    except Exception as e:  # pydantic ValidationError 等
        logger.warning("LLM 返回无法通过 schema 校验: %s | 原始: %s", e, raw)
        raise LLMError("LLM 返回的命令不符合规范") from e


async def parse_by_llm(request: ParseCommandRequest, client: LLMClient) -> DrawingCommand:
    """基于 LLM 的语义解析

    Args:
        request: 解析请求
        client: 已配置的 LLM 客户端

    Returns:
        解析出的命令

    Raises:
        LLMError: 调用失败或返回非法
    """
    user_prompt = _build_user_prompt(request.text, request.context)
    raw = await client.chat_json(_LLM_SYSTEM_PROMPT, user_prompt)
    command = _command_from_llm(raw, request.text)
    logger.info("LLM 解析成功: action=%s, confidence=%.2f", command.action, command.confidence)
    return command


# ===================== 目标解析（指代消解） =====================


def _match_layers_by_name(name: str, layers: list[RecentLayerContext]) -> list[RecentLayerContext]:
    """按名称在最近图层中模糊匹配（名称/语义描述/文本内容/提示词）"""
    needle = name.strip()
    matches: list[RecentLayerContext] = []
    for layer in layers:
        haystacks = [
            layer.name,
            layer.semantic_description or "",
            layer.text_content or "",
            layer.prompt or "",
        ]
        if any(needle in (h or "") for h in haystacks):
            matches.append(layer)
    return matches


def resolve_target(
    command: DrawingCommand, context: ParseCommandContext, text: str
) -> ClarificationResult | None:
    """解析命令目标（指代消解）

    将 target.name / target.reference 解析为具体图层 ID，并写回 command.target.id。
    解析失败（找不到 / 多个候选）时返回澄清结果，否则返回 None。
    """
    if command.action not in TARGET_REQUIRED_ACTIONS:
        return None

    target = command.target
    recent = context.recent_layers

    # 已显式指定 ID，直接信任
    if target and target.id:
        return None

    # 按名称匹配
    if target and target.name:
        matches = _match_layers_by_name(target.name, recent)
        if len(matches) == 1:
            command.target = target.model_copy(update={"id": matches[0].id})
            return None
        if len(matches) > 1:
            return _ambiguous_target_clarification(command, text, matches)
        # 0 个匹配：继续尝试选中图层 / 判定缺失

    # 指代"选中" 或 无目标时默认作用于当前选中图层
    if context.selected_layer_id:
        new_target = (target or CommandTarget()).model_copy(
            update={"id": context.selected_layer_id}
        )
        command.target = new_target
        return None

    # 既无匹配也无选中图层 → 缺少目标
    return _missing_target_clarification(command, recent, text)


# ===================== 澄清回环构造 =====================

_ACTION_LABELS: dict[CommandAction, str] = {
    CommandAction.CREATE: "新建",
    CommandAction.SELECT: "选择",
    CommandAction.MODIFY: "修改",
    CommandAction.DELETE: "删除",
    CommandAction.DUPLICATE: "复制",
    CommandAction.GROUP: "分组",
    CommandAction.UNGROUP: "取消分组",
    CommandAction.REORDER: "调整层级",
    CommandAction.RENAME: "重命名",
    CommandAction.UNDO: "撤销",
    CommandAction.REDO: "重做",
    CommandAction.SAVE: "保存",
}


def describe_command(command: DrawingCommand) -> str:
    """生成命令的简短中文描述，用于澄清提问"""
    action_label = _ACTION_LABELS.get(command.action, command.action.value)
    subject = ""
    if command.objects:
        subject = "、".join(obj.name for obj in command.objects[:3])
    elif command.prompt:
        subject = command.prompt
    elif command.target and command.target.name:
        subject = command.target.name

    if subject:
        return f"{action_label}「{subject}」"
    return action_label


def _layer_label(layer: RecentLayerContext) -> str:
    """图层在候选项中的展示文案"""
    if layer.text_content:
        return f"{layer.name}（{layer.text_content}）"
    return layer.name


def _ambiguous_target_clarification(
    command: DrawingCommand, text: str, matches: list[RecentLayerContext]
) -> ClarificationResult:
    options = [
        ClarificationOption(id=layer.id, label=_layer_label(layer), targetId=layer.id)
        for layer in matches[:10]
    ]
    action_label = _ACTION_LABELS.get(command.action, command.action.value)
    return ClarificationResult(
        reason=ClarificationReason.AMBIGUOUS_TARGET,
        question=f"画面中有多个匹配对象，你想{action_label}哪一个？",
        originalText=text,
        options=options,
        candidate=command,
    )


def _missing_target_clarification(
    command: DrawingCommand, recent: list[RecentLayerContext], text: str
) -> ClarificationResult:
    options = [
        ClarificationOption(id=layer.id, label=_layer_label(layer), targetId=layer.id)
        for layer in recent[:10]
    ]
    action_label = _ACTION_LABELS.get(command.action, command.action.value)
    return ClarificationResult(
        reason=ClarificationReason.MISSING_TARGET,
        question=f"没听清你要{action_label}哪个对象，请指定一下。",
        originalText=text,
        options=options,
        candidate=command,
    )


def _low_confidence_clarification(command: DrawingCommand, text: str) -> ClarificationResult:
    return ClarificationResult(
        reason=ClarificationReason.LOW_CONFIDENCE,
        question=f"你是想{describe_command(command)}吗？",
        originalText=text,
        options=[
            ClarificationOption(id="confirm", label="是的，确认执行"),
            ClarificationOption(id="cancel", label="不是，重新说"),
        ],
        candidate=command,
    )


def _post_process(
    command: DrawingCommand, request: ParseCommandRequest, threshold: float
) -> DrawingCommand | ClarificationResult:
    """命令后处理：目标解析 + 置信度澄清回环"""
    target_clarify = resolve_target(command, request.context, request.text)
    if target_clarify is not None:
        return target_clarify

    if command.confidence < threshold:
        return _low_confidence_clarification(command, request.text)

    return command


async def parse_command(
    request: ParseCommandRequest,
    *,
    client: LLMClient | None = None,
    settings: Settings | None = None,
) -> DrawingCommand | ClarificationResult | dict[str, Any]:
    """统一命令解析入口

    Args:
        request: 解析请求（包含文本和上下文）
        client: 可选注入的 LLM 客户端（便于测试）
        settings: 可选注入的配置（便于测试）

    Returns:
        DrawingCommand（可执行）、ClarificationResult（需用户澄清）或错误字典
    """
    settings = settings or get_settings()
    threshold = settings.command_confidence_threshold
    provider = settings.command_provider
    text = request.text

    # 1. 极速路径
    fast = parse_fast_path(text)
    if fast is not None:
        logger.info("极速路径命中: action=%s", fast.action)
        return _post_process(fast, request, threshold)

    # 2. LLM 语义解析（llm / hybrid）
    if provider in ("llm", "hybrid"):
        client = client or LLMClient.from_settings(settings)
        if client.is_configured:
            try:
                command = await parse_by_llm(request, client)
                return _post_process(command, request, threshold)
            except LLMError as e:
                logger.warning("LLM 解析失败: %s", e)
                if provider == "llm":
                    return _unsupported_error(text, detail=str(e))
                # hybrid 模式下回退到规则
        elif provider == "llm":
            return _unsupported_error(text, detail="LLM 未配置")

    # 3. 规则回退（rules，或 hybrid 下 LLM 不可用/失败）
    rule_result = parse_by_rules(text, request.context.model_dump(by_alias=True))
    if rule_result is not None:
        logger.info("规则解析成功: action=%s", rule_result.action)
        return _post_process(rule_result, request, threshold)

    return _unsupported_error(text)


def _unsupported_error(text: str, detail: str | None = None) -> dict[str, Any]:
    """构造无法解析的中文错误响应"""
    message = f"无法理解指令：「{text}」，请换种说法再试一次"
    if detail:
        logger.debug("解析失败详情: %s", detail)
    return {
        "error": {
            "code": "UNSUPPORTED_COMMAND",
            "message": message,
            "retryable": True,
            "requestId": _new_command_id(),
        }
    }
