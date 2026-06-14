"""命令解析器

将用户自然语言输入解析为结构化绘画命令。
包含规则解析器（快速精确匹配）和 LLM 解析器（语义理解）。
"""

import logging
import re
import uuid
from typing import Any

from src.models.commands import DrawingCommand, ParseCommandRequest

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


def parse_by_rules(text: str, context: dict[str, Any]) -> DrawingCommand | None:
    """基于规则的命令解析

    使用关键词匹配快速识别用户意图。
    规则解析速度快且无外部依赖，优先于 LLM 解析。

    Args:
        text: 用户输入文本
        context: 画布上下文信息

    Returns:
        解析出的命令，无法识别时返回 None
    """
    text_lower = text.strip()

    # 匹配动作
    matched_action: str | None = None
    for action, keywords in ACTION_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text_lower:
                matched_action = action
                break
        if matched_action:
            break

    if matched_action is None:
        return None

    # 构建基本命令
    command_id = str(uuid.uuid4())
    requires_generation = matched_action == "create"

    command_data: dict[str, Any] = {
        "schemaVersion": 1,
        "id": command_id,
        "action": matched_action,
        "requiresGeneration": requires_generation,
        "confidence": 0.7,  # 规则匹配置信度较低
    }

    # 对 create 动作提取 prompt（关键词后面的内容）
    if matched_action == "create":
        for keyword in ACTION_KEYWORDS["create"]:
            if keyword in text_lower:
                idx = text_lower.index(keyword) + len(keyword)
                remaining = text_lower[idx:].strip()
                # 去除常见连接词
                remaining = re.sub(r"^(一个|一只|一棵|个|只|幅|张|把|条)", "", remaining)
                if remaining:
                    command_data["prompt"] = remaining
                break

    return DrawingCommand.model_validate(command_data)


def parse_command(
    request: ParseCommandRequest,
) -> DrawingCommand | dict[str, Any]:
    """统一命令解析入口

    解析策略：
    1. 先尝试规则解析（快速、无依赖）
    2. 规则解析失败时尝试 LLM 解析（准确、需要 API）
    3. 都失败时返回错误

    Args:
        request: 解析请求（包含文本和上下文）

    Returns:
        DrawingCommand 或错误字典
    """
    text = request.text
    context = request.context.model_dump(by_alias=True)

    # 1. 规则解析
    rule_result = parse_by_rules(text, context)
    if rule_result is not None:
        logger.info("规则解析成功: action=%s", rule_result.action)
        return rule_result

    # 2. LLM 解析 (TODO: Task 5b 实现)
    logger.info("规则解析未匹配，需要 LLM 解析: '%s'", text)

    # 暂时返回错误
    return {
        "error": {
            "code": "UNSUPPORTED_COMMAND",
            "message": f"无法理解指令: '{text}'，请尝试更明确的描述",
            "retryable": True,
            "requestId": str(uuid.uuid4()),
        }
    }
