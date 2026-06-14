"""Compatibility tests for the web command contract."""

from src.config import Settings
from src.models.commands import ParseCommandRequest
from src.services.command_parser import parse_command


def request(text: str) -> ParseCommandRequest:
    return ParseCommandRequest.model_validate(
        {
            "schemaVersion": 1,
            "text": text,
            "context": {
                "selectedLayerId": "sun",
                "recentLayers": [
                    {"id": "tree", "name": "树", "type": "preset"},
                    {"id": "sun", "name": "太阳", "type": "preset"},
                ],
                "globalStyle": "",
            },
        }
    )


def test_parses_compound_local_transform() -> None:
    command = parse_command(request("把太阳变小一点并移到右上角"), Settings())
    assert command is not None
    assert command.action.value == "modify"
    assert command.target and command.target.name == "太阳"
    assert command.properties and command.properties.position == "top-right"
    assert command.properties.size == "smaller"
    assert command.requires_generation is False


def test_color_change_uses_asset_edit_path() -> None:
    command = parse_command(request("将太阳涂成红色"), Settings())
    assert command is not None
    assert command.properties and command.properties.color == "#dc2626"
    assert command.requires_generation is True


def test_group_uses_explicit_layer_ids() -> None:
    command = parse_command(request("把树和太阳组合"), Settings())
    assert command is not None
    assert command.action.value == "group"
    assert command.target and command.target.ids == ["tree", "sun"]


def test_text_command_preserves_content_and_style() -> None:
    command = parse_command(request("在顶部写上“今天也要开心”，用醒目的红色粗体"), Settings())
    assert command is not None
    assert command.object_type and command.object_type.value == "text"
    assert command.properties and command.properties.text == "今天也要开心"
    assert command.properties.color == "#dc2626"
    assert command.properties.font_weight == "bold"


def test_create_splits_counted_interaction_into_scene_objects() -> None:
    command = parse_command(request("画两只猫抓老鼠"), Settings())

    assert command is not None
    assert command.requires_generation is True
    assert command.objects is not None
    assert [obj.name for obj in command.objects] == ["背景", "小猫1", "小猫2", "老鼠"]
    assert command.objects[0].background == "opaque"
    assert command.objects[1].background == "transparent"
    assert command.objects[2].position.value == "right"
    assert "mouse" in command.objects[1].prompt
    assert "cat" in command.objects[3].negative_prompt


def test_create_understands_scene_description_without_create_verb() -> None:
    command = parse_command(request("两只猫在玩耍"), Settings())

    assert command is not None
    assert command.action.value == "create"
    assert command.objects is not None
    assert [obj.name for obj in command.objects] == ["背景", "小猫1", "小猫2"]
    assert command.objects[0].is_background is True
    assert command.objects[1].position.value == "left"
