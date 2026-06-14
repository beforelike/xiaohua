"""命令解析器测试

覆盖：极速路径、规则解析（含歧义）、LLM 解析（mock）、
指代消解/目标解析、置信度澄清回环。
"""

from typing import Any

import pytest

from src.config import Settings
from src.models.commands import (
    ClarificationReason,
    ClarificationResult,
    CommandAction,
    DrawingCommand,
    ParseCommandContext,
    ParseCommandRequest,
    RecentLayerContext,
)
from src.models.project import LayerType
from src.services.command_parser import (
    parse_by_rules,
    parse_command,
    parse_fast_path,
    resolve_target,
)
from src.services.llm_client import (
    LLMError,
    _extract_content,
    _parse_json_content,
)


def _settings(provider: str = "rules", threshold: float = 0.6) -> Settings:
    """构造确定性配置，避免读取真实环境导致测试不稳定"""
    return Settings(
        command_provider=provider,
        command_confidence_threshold=threshold,
        llm_base_url="",
        llm_model="",
    )


def _layer(layer_id: str, name: str, **kwargs: Any) -> RecentLayerContext:
    return RecentLayerContext(id=layer_id, name=name, type=LayerType.IMAGE, **kwargs)


def _request(
    text: str,
    *,
    selected_layer_id: str | None = None,
    recent_layers: list[RecentLayerContext] | None = None,
) -> ParseCommandRequest:
    context = ParseCommandContext(
        selected_layer_id=selected_layer_id,
        recent_layers=recent_layers or [],
        global_style="",
    )
    return ParseCommandRequest(text=text, context=context)


class FakeLLMClient:
    """测试用的 LLM 客户端替身"""

    def __init__(self, payload: dict[str, Any] | None = None, error: Exception | None = None):
        self._payload = payload
        self._error = error
        self.is_configured = True
        self.calls: list[tuple[str, str]] = []

    async def chat_json(self, system_prompt: str, user_prompt: str, **_: Any) -> dict[str, Any]:
        self.calls.append((system_prompt, user_prompt))
        if self._error is not None:
            raise self._error
        assert self._payload is not None
        return self._payload


# ===================== 极速路径 =====================


class TestFastPath:
    def test_undo(self):
        cmd = parse_fast_path("撤销")
        assert cmd is not None
        assert cmd.action == CommandAction.UNDO
        assert cmd.confidence == 1.0
        assert cmd.requires_generation is False

    def test_confirm(self):
        cmd = parse_fast_path("确认")
        assert cmd is not None
        assert cmd.action == CommandAction.CONFIRM

    def test_no_match(self):
        assert parse_fast_path("画一只猫") is None

    def test_exact_match_only(self):
        # 仅整句精确匹配，避免误触发
        assert parse_fast_path("保存这张图到桌面") is None


# ===================== 规则解析 =====================


class TestParseByRules:
    def test_create_extracts_prompt(self):
        cmd = parse_by_rules("画一只猫", {})
        assert cmd is not None
        assert cmd.action == CommandAction.CREATE
        assert cmd.prompt == "猫"
        assert cmd.requires_generation is True

    def test_delete_action(self):
        cmd = parse_by_rules("删除", {})
        assert cmd is not None
        assert cmd.action == CommandAction.DELETE
        assert cmd.requires_generation is False

    def test_unknown_returns_none(self):
        assert parse_by_rules("今天天气不错", {}) is None

    def test_multiple_actions_defers_to_llm(self):
        # 同时命中 modify(改) 与 duplicate(复制) → 规则放弃，返回 None
        assert parse_by_rules("改一下并复制", {}) is None


# ===================== 目标解析 / 指代消解 =====================


class TestResolveTarget:
    def _modify_cmd(self, target_name: str | None = None) -> DrawingCommand:
        data: dict[str, Any] = {
            "schemaVersion": 1,
            "id": "cmd-1",
            "action": "modify",
            "requiresGeneration": False,
            "confidence": 0.9,
            "properties": {"scaleDelta": 0.5},
        }
        if target_name:
            data["target"] = {"name": target_name}
        return DrawingCommand.model_validate(data)

    def test_single_match_resolves_id(self):
        ctx = ParseCommandContext(
            selected_layer_id=None,
            recent_layers=[_layer("layer-cat", "猫")],
            global_style="",
        )
        cmd = self._modify_cmd("猫")
        result = resolve_target(cmd, ctx, "把猫放大")
        assert result is None
        assert cmd.target is not None
        assert cmd.target.id == "layer-cat"

    def test_multiple_matches_ambiguous(self):
        ctx = ParseCommandContext(
            selected_layer_id=None,
            recent_layers=[_layer("c1", "大猫"), _layer("c2", "小猫")],
            global_style="",
        )
        cmd = self._modify_cmd("猫")
        result = resolve_target(cmd, ctx, "把猫放大")
        assert isinstance(result, ClarificationResult)
        assert result.reason == ClarificationReason.AMBIGUOUS_TARGET
        assert len(result.options) == 2

    def test_fallback_to_selected_layer(self):
        ctx = ParseCommandContext(
            selected_layer_id="selected-1",
            recent_layers=[],
            global_style="",
        )
        cmd = self._modify_cmd()
        result = resolve_target(cmd, ctx, "放大一点")
        assert result is None
        assert cmd.target is not None
        assert cmd.target.id == "selected-1"

    def test_missing_target(self):
        ctx = ParseCommandContext(
            selected_layer_id=None,
            recent_layers=[],
            global_style="",
        )
        cmd = self._modify_cmd()
        result = resolve_target(cmd, ctx, "放大一点")
        assert isinstance(result, ClarificationResult)
        assert result.reason == ClarificationReason.MISSING_TARGET

    def test_create_skips_target_resolution(self):
        ctx = ParseCommandContext(
            selected_layer_id=None, recent_layers=[], global_style=""
        )
        cmd = DrawingCommand.model_validate(
            {
                "schemaVersion": 1,
                "id": "cmd-c",
                "action": "create",
                "requiresGeneration": True,
                "confidence": 0.9,
                "prompt": "a cat",
            }
        )
        assert resolve_target(cmd, ctx, "画一只猫") is None


# ===================== 端到端解析（async） =====================


class TestParseCommand:
    async def test_fast_path_priority(self):
        result = await parse_command(_request("撤销"), settings=_settings())
        assert isinstance(result, DrawingCommand)
        assert result.action == CommandAction.UNDO

    async def test_rules_create(self):
        result = await parse_command(_request("画一只猫"), settings=_settings("rules"))
        assert isinstance(result, DrawingCommand)
        assert result.action == CommandAction.CREATE
        assert result.prompt == "猫"

    async def test_unsupported_returns_error(self):
        result = await parse_command(_request("今天天气不错"), settings=_settings("rules"))
        assert isinstance(result, dict)
        assert result["error"]["code"] == "UNSUPPORTED_COMMAND"

    async def test_llm_high_confidence(self):
        fake = FakeLLMClient(
            {
                "action": "create",
                "requiresGeneration": True,
                "confidence": 0.95,
                "objects": [
                    {
                        "name": "猫",
                        "prompt": "a cute cat",
                        "background": "transparent",
                        "position": "center",
                        "size": "medium",
                    }
                ],
            }
        )
        result = await parse_command(
            _request("画一只可爱的猫"), client=fake, settings=_settings("hybrid")
        )
        assert isinstance(result, DrawingCommand)
        assert result.action == CommandAction.CREATE
        assert result.objects is not None
        assert result.objects[0].name == "猫"

    async def test_llm_low_confidence_triggers_clarification(self):
        fake = FakeLLMClient(
            {
                "action": "create",
                "requiresGeneration": True,
                "confidence": 0.3,
                "prompt": "something",
            }
        )
        result = await parse_command(
            _request("那个那个东西"), client=fake, settings=_settings("hybrid", threshold=0.6)
        )
        assert isinstance(result, ClarificationResult)
        assert result.reason == ClarificationReason.LOW_CONFIDENCE
        assert result.candidate is not None

    async def test_llm_ambiguous_target_clarification(self):
        fake = FakeLLMClient(
            {
                "action": "modify",
                "requiresGeneration": False,
                "confidence": 0.9,
                "target": {"name": "猫"},
                "properties": {"scaleDelta": 0.5},
            }
        )
        result = await parse_command(
            _request(
                "把猫放大",
                recent_layers=[_layer("c1", "大猫"), _layer("c2", "小猫")],
            ),
            client=fake,
            settings=_settings("hybrid"),
        )
        assert isinstance(result, ClarificationResult)
        assert result.reason == ClarificationReason.AMBIGUOUS_TARGET

    async def test_hybrid_falls_back_to_rules_on_llm_error(self):
        fake = FakeLLMClient(error=LLMError("连接失败"))
        result = await parse_command(
            _request("画一只猫"), client=fake, settings=_settings("hybrid")
        )
        # LLM 失败后回退规则解析
        assert isinstance(result, DrawingCommand)
        assert result.action == CommandAction.CREATE

    async def test_llm_only_error_returns_error(self):
        fake = FakeLLMClient(error=LLMError("连接失败"))
        result = await parse_command(
            _request("画一只猫"), client=fake, settings=_settings("llm")
        )
        assert isinstance(result, dict)
        assert result["error"]["code"] == "UNSUPPORTED_COMMAND"


# ===================== LLM 客户端 JSON 解析 =====================


class TestLLMJsonParsing:
    def test_plain_json(self):
        assert _parse_json_content('{"a": 1}') == {"a": 1}

    def test_fenced_json(self):
        content = '```json\n{"action": "create"}\n```'
        assert _parse_json_content(content) == {"action": "create"}

    def test_json_with_surrounding_text(self):
        content = '好的，解析结果是：{"action": "delete"} 完成'
        assert _parse_json_content(content) == {"action": "delete"}

    def test_invalid_json_raises(self):
        with pytest.raises(LLMError):
            _parse_json_content("这里没有任何 JSON")

    def test_extract_content_ok(self):
        data = {"choices": [{"message": {"content": '{"x": 1}'}}]}
        assert _extract_content(data) == '{"x": 1}'

    def test_extract_content_empty_raises(self):
        with pytest.raises(LLMError):
            _extract_content({"choices": [{"message": {"content": ""}}]})

    def test_extract_content_malformed_raises(self):
        with pytest.raises(LLMError):
            _extract_content({"unexpected": True})
