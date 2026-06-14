"""Image generation adapter tests."""

from pathlib import Path

from src.config import Settings
from src.models.generation import GenerateAssetRequest
from src.services.image_generation import generate_asset, read_asset


def test_mock_generation_persists_a_readable_asset(tmp_path: Path) -> None:
    settings = Settings(image_provider="mock", asset_cache_dir=str(tmp_path))
    request = GenerateAssetRequest.model_validate(
        {
            "schemaVersion": 1,
            "commandId": "cmd-test",
            "prompt": "太阳",
            "width": 512,
            "height": 512,
            "background": "transparent",
        }
    )

    result = generate_asset(request, settings)
    asset = result["asset"]

    assert asset["source"] == "preset"
    assert asset["mimeType"] == "image/svg+xml"
    stored = read_asset(asset["id"], settings)
    assert stored is not None
    assert stored[1] == "image/svg+xml"
    assert b"<svg" in stored[0]
