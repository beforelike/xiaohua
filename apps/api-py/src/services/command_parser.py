"""Natural-language command parsing with deterministic rules and LLM fallback."""

import json
import re
import uuid
from typing import Any

import httpx

from src.config import Settings
from src.models.commands import DrawingCommand, ParseCommandRequest


def _id() -> str:
    return str(uuid.uuid4())


def _target(text: str, names: list[str]) -> dict[str, Any] | None:
    for name in sorted(names, key=len, reverse=True):
        if name and name in text:
            return {"name": name}
    if re.search(r"它|这个|刚才那个|选中的", text):
        return {"reference": "selected"}
    return None


def _position(text: str) -> str | None:
    pairs = [
        (r"右上", "top-right"),
        (r"左上", "top-left"),
        (r"右下", "bottom-right"),
        (r"左下", "bottom-left"),
        (r"顶部|上方|上面", "top"),
        (r"底部|下方|下面", "bottom"),
        (r"左边|左侧", "left"),
        (r"右边|右侧|旁边", "right"),
        (r"中间|中央|中心", "center"),
    ]
    return next((value for pattern, value in pairs if re.search(pattern, text)), None)


def _color(text: str) -> str | None:
    colors = {
        "红": "#dc2626",
        "橙": "#ea580c",
        "黄": "#eab308",
        "绿": "#16a34a",
        "蓝": "#2563eb",
        "紫": "#9333ea",
        "粉": "#ec4899",
        "黑": "#111827",
        "白": "#f8fafc",
    }
    return next((value for name, value in colors.items() if name in text), None)


def _command(action: str, **values: Any) -> DrawingCommand:
    return DrawingCommand.model_validate(
        {
            "schemaVersion": 1,
            "id": _id(),
            "action": action,
            "requiresGeneration": values.pop("requiresGeneration", False),
            "confidence": values.pop("confidence", 0.98),
            **values,
        }
    )


def parse_by_rules(request: ParseCommandRequest) -> DrawingCommand | None:
    text = re.sub(r"\s+", "", request.text.strip())
    layers = request.context.recent_layers
    names = [layer.name for layer in layers]
    target = _target(text, names)

    if re.fullmatch(r"撤销|撤回|取消上一步", text):
        return _command("undo")
    if re.fullmatch(r"重做|恢复上一步", text):
        return _command("redo")
    if re.search(r"保存|导出", text):
        return _command("save")
    if re.search(r"取消.*组合|解组|取消分组", text):
        return _command("ungroup", target=target)
    if re.search(r"组合|编组|分组", text):
        ids = [layer.id for layer in layers if layer.name in text]
        return _command("group", target={"ids": ids} if len(ids) >= 2 else target)
    if re.search(r"删除|移除|去掉|删掉", text):
        return _command("delete", target=target)
    if re.search(r"复制|克隆|拷贝", text):
        return _command("duplicate", target=target or {"reference": "selected"})
    if re.search(r"选择|选中", text):
        return _command("select", target=target)
    if re.search(r"重命名|改名", text):
        match = re.search(r"(?:重命名|改名)(?:为|成)?[“\"]?([^”\"]+)[”\"]?", text)
        return _command(
            "rename",
            target=target,
            properties={"name": match.group(1)} if match else {},
        )

    text_match = re.search(
        r"(?:写上|写下|添加文字|加上文字|标题是)[“\"]?([^”\"]+?)[”\"]?(?:，|,|用|$)",
        request.text,
    )
    if text_match:
        content = text_match.group(1).strip()
        properties: dict[str, Any] = {
            "text": content,
            "name": content[:80],
            "position": _position(text),
        }
        color = _color(text)
        if color:
            properties["color"] = color
        if "粗体" in text or "醒目" in text:
            properties["fontWeight"] = "bold"
        if re.search(r"涂鸦|手写|活泼", text):
            properties["fontFamily"] = '"KaiTi", "STKaiti", cursive'
        return _command(
            "create",
            objectType="text",
            prompt=content,
            properties=properties,
        )

    if re.search(r"画成|重新生成|重画|改成一", text) and target:
        return _command(
            "modify",
            target=target,
            prompt=request.text,
            requiresGeneration=True,
        )
    if re.search(r"戴上|戴着|加上|添上|挂上|系上|拿着|抱着", text) and target:
        return _command(
            "modify",
            target=target,
            prompt=request.text,
            requiresGeneration=True,
        )

    modify_signal = re.search(
        r"移到|移动|变小|缩小|变大|放大|旋转|转一点|透明|隐藏|显示|锁定|解锁|涂成|改成.*色|置顶|置底|上移|下移",
        text,
    )
    if modify_signal:
        properties: dict[str, Any] = {}
        position = _position(text)
        if position:
            properties["position"] = position
        if re.search(r"变小|缩小", text):
            properties["size"] = "smaller"
        if re.search(r"变大|放大", text):
            properties["size"] = "larger"
        color = _color(text)
        if color:
            properties["color"] = color
        if "半透明" in text:
            properties["opacity"] = 0.5
        if "不透明" in text:
            properties["opacity"] = 1
        if "隐藏" in text:
            properties["visible"] = False
        if "显示" in text:
            properties["visible"] = True
        if "解锁" in text:
            properties["locked"] = False
        elif "锁定" in text:
            properties["locked"] = True
        if re.search(r"顺时针|再转一点|旋转", text):
            properties["rotationDelta"] = 15
        z_order = next(
            (
                value
                for pattern, value in [
                    ("置顶", "front"),
                    ("置底", "back"),
                    ("上移", "up"),
                    ("下移", "down"),
                ]
                if pattern in text
            ),
            None,
        )
        if z_order:
            return _command("reorder", target=target, properties={"zOrder": z_order})
        return _command(
            "modify",
            target=target,
            properties=properties,
            requiresGeneration=bool(color),
        )

    create_match = re.search(
        r"(?:画|添加|创建|加|生成|新建)(?:一个|一只|一棵|一片|一匹|个|只|棵|片|匹)?([^，。,.]+)",
        text,
    )
    if create_match:
        name = create_match.group(1)
        name = re.sub(r"^(?:在左边|在右边|在右上角|在左上角)", "", name)
        name = re.sub(r"(?:在.*|到.*)$", "", name).strip() or "新元素"
        relation_target = _target(text, names)
        return _command(
            "create",
            objectType="image",
            prompt=request.text,
            target=relation_target,
            properties={"name": name[:80], "position": _position(text)},
            requiresGeneration=True,
        )
    return None


def _extract_json(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("LLM 未返回 JSON")
    return json.loads(text[start : end + 1])


def parse_with_llm(request: ParseCommandRequest, settings: Settings) -> DrawingCommand | None:
    if not settings.llm_base_url or not settings.llm_model or not settings.llm_api_key:
        return None
    prompt = (
        "将中文绘图指令转换为 DrawingCommand JSON。只输出 JSON。"
        "action 可选 create/select/modify/delete/duplicate/group/ungroup/"
        "reorder/rename/undo/redo/save。创建图片时 requiresGeneration=true，"
        "properties.position 使用 top-left/top/top-right/left/center/right/"
        "bottom-left/bottom/bottom-right。上下文："
        f"{request.context.model_dump_json(by_alias=True)}\n用户：{request.text}"
    )
    with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
        response = client.post(
            f"{settings.llm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={
                "model": settings.llm_model,
                "temperature": settings.llm_temperature,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    data = _extract_json(content)
    data.setdefault("schemaVersion", 1)
    data.setdefault("id", _id())
    data.setdefault("confidence", 0.9)
    data.setdefault("requiresGeneration", data.get("action") == "create")
    return DrawingCommand.model_validate(data)


def parse_command(request: ParseCommandRequest, settings: Settings) -> DrawingCommand | None:
    """Parse with deterministic rules, then optional LLM fallback."""
    rule = parse_by_rules(request)
    if rule is not None:
        return rule
    if settings.command_provider in {"llm", "hybrid"}:
        return parse_with_llm(request, settings)
    return None
