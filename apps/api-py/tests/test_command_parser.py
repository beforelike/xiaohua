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
