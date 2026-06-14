"""Natural-language command parsing with deterministic rules and LLM fallback."""

import json
import re
import uuid
from typing import Any

import httpx

from src.config import Settings
from src.models.commands import DrawingCommand, ParseCommandRequest

COUNT_WORDS = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}

SUBJECTS = [
    {
        "name": "小猫",
        "keywords": ("猫", "小猫", "猫咪"),
        "english": "cat",
        "identity": (
            "domestic cat, furry body, feline face, triangular ears, whiskers, "
            "visible tail, four legs with paws"
        ),
        "negative": (
            "dog, mouse, horse, bird, human, humanoid, abstract shape, ring, torus, random object"
        ),
    },
    {
        "name": "老鼠",
        "keywords": ("老鼠", "鼠", "小鼠"),
        "english": "mouse",
        "identity": "small mouse, rodent body, round ears, pointed nose, long thin tail, tiny paws",
        "negative": "cat, dog, horse, bird, human, humanoid, abstract random object",
    },
    {
        "name": "小狗",
        "keywords": ("狗", "小狗", "狗狗"),
        "english": "dog",
        "identity": (
            "friendly dog, canine face, floppy ears, wagging tail, four legs with paws, furry body"
        ),
        "negative": "cat, mouse, horse, bird, human, humanoid, abstract random object",
    },
    {
        "name": "马",
        "keywords": ("马",),
        "english": "horse",
        "identity": "horse, equine body, mane, tail, four long legs with hooves, full body visible",
        "negative": "cat, dog, mouse, bird, human, humanoid, abstract random object",
    },
    {
        "name": "小鸟",
        "keywords": ("鸟", "小鸟", "鸟儿"),
        "english": "bird",
        "identity": "small bird, feathers, beak, wings, tail feathers, tiny feet",
        "negative": "cat, dog, mouse, horse, human, humanoid, abstract random object",
    },
]

INTERACTION_RE = re.compile(r"玩耍|追逐|抓|追|扑|打闹|互动|一起|陪伴|看着|望着|争抢")
BACKGROUND_RE = re.compile(
    r"背景|场景|草地|草坪|草原|森林|树林|河边|河流|小溪|湖边|海边|天空|花园|庭院|房间|室内|街道"
)


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


def _parse_count(value: str | None) -> int:
    if not value:
        return 1
    return COUNT_WORDS.get(value, int(value) if value.isdigit() else 1)


def _subject_for_text(text: str) -> dict[str, Any] | None:
    return next(
        (
            subject
            for subject in SUBJECTS
            if any(keyword in text for keyword in subject["keywords"])
        ),
        None,
    )


def _subject_counts(text: str) -> list[tuple[dict[str, Any], int]]:
    found: list[tuple[dict[str, Any], int]] = []
    for subject in SUBJECTS:
        keyword_pattern = "|".join(re.escape(keyword) for keyword in subject["keywords"])
        counted = re.search(
            rf"([一二两三四五六七八九十]|\d+)[只匹个头条羽]?(?:{keyword_pattern})",
            text,
        )
        if counted:
            found.append((subject, min(_parse_count(counted.group(1)), 6)))
        elif any(keyword in text for keyword in subject["keywords"]):
            found.append((subject, 1))
    return found


def _scene_objects_from_text(text: str) -> list[dict[str, Any]]:
    subjects = _subject_counts(text)
    foreground_total = sum(count for _, count in subjects)
    if foreground_total < 2 and not (subjects and INTERACTION_RE.search(text)):
        return []

    positions = ["left", "right", "center", "bottom-left", "bottom-right", "top-left"]
    objects: list[dict[str, Any]] = [
        {
            "name": "背景",
            "prompt": ", ".join(
                [
                    f"environmental background plate for: {text}",
                    "rich but unobtrusive contextual details",
                    "clear ground plane, soft light",
                    "open central space reserved for foreground subjects",
                    "no main animals, no characters, no text",
                ]
            ),
            "negativePrompt": (
                "cats, dogs, mice, horses, birds, people, main subject, "
                "foreground character, text, watermark, random abstract shapes"
            ),
            "background": "opaque",
            "isBackground": True,
            "position": "center",
            "size": "full",
        }
    ]
    position_index = 0
    for subject, count in subjects:
        for index in range(count):
            suffix = str(index + 1) if count > 1 else ""
            other_subjects = [
                other["english"] for other, _ in subjects if other["english"] != subject["english"]
            ]
            relation = (
                f"interacting with {', '.join(other_subjects)}"
                if other_subjects
                else f"interacting with the other {subject['english']}s"
            )
            objects.append(
                {
                    "name": f"{subject['name']}{suffix}",
                    "prompt": ", ".join(
                        [
                            f"one distinct {subject['english']}",
                            subject["identity"],
                            relation,
                            "dynamic pose matching the user request",
                            "complete body visible, generous empty margin",
                            "isolated foreground asset, solid white background, no background",
                        ]
                    ),
                    "identityPrompt": f"{subject['english']}, {subject['identity']}",
                    "actionPrompt": f"{relation}, dynamic pose matching: {text}",
                    "negativePrompt": ", ".join(
                        [
                            "complex background, busy background, cropped body",
                            "missing limbs, duplicate body",
                            subject["negative"],
                        ]
                    ),
                    "background": "transparent",
                    "isBackground": False,
                    "position": positions[position_index % len(positions)],
                    "size": "medium",
                }
            )
            position_index += 1
    return objects


def _create_scene_command_from_objects(
    request: ParseCommandRequest,
    text: str,
    objects: list[dict[str, Any]],
    target: dict[str, Any] | None = None,
) -> DrawingCommand:
    primary_subject = _subject_for_text(text)
    return _command(
        "create",
        objectType="image",
        prompt=request.text,
        target=target,
        properties={
            "name": (primary_subject["name"] if primary_subject else "新元素")[:80],
            "position": _position(text),
        },
        objects=objects,
        style=request.context.global_style
        or "warm storybook illustration, clean composition, soft daylight",
        creativeDirection="根据用户提示拆分主体与背景，先放置可编辑占位图，再分别生成素材。",
        sceneSummary=f"画面包含：{'、'.join(obj['name'] for obj in objects)}",
        requiresGeneration=True,
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
        objects = _scene_objects_from_text(text)
        if objects:
            return _create_scene_command_from_objects(
                request,
                text,
                objects,
                relation_target,
            )
        return _command(
            "create",
            objectType="image",
            prompt=request.text,
            target=relation_target,
            properties={"name": name[:80], "position": _position(text)},
            requiresGeneration=True,
        )
    objects = _scene_objects_from_text(text)
    if objects:
        return _create_scene_command_from_objects(request, text, objects, target)
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
