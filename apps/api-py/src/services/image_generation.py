"""Local Fooocus generation and asset storage."""

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from src.config import Settings
from src.models.generation import GenerateAssetRequest
from src.services.async_worker import AsyncTask
from src.services.fooocus_adapter import generate_with_fooocus

PIPELINE_VERSION = 17


class ImageGenerationError(RuntimeError):
    """Raised when local image generation fails."""


def _asset_id(request: GenerateAssetRequest, settings: Settings) -> str:
    payload = request.model_dump(by_alias=True, exclude_none=True)
    payload["provider"] = settings.image_provider
    payload["pipelineVersion"] = PIPELINE_VERSION
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:24]


def _cache_dir(settings: Settings) -> Path:
    configured = Path(settings.asset_cache_dir)
    path = (
        configured if configured.is_absolute() else Path(__file__).resolve().parents[4] / configured
    ).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _mock_svg(request: GenerateAssetRequest) -> bytes:
    label = request.prompt.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")[:40]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<rect width="512" height="512" fill="#fffdf7"/>'
        '<circle cx="256" cy="230" r="112" fill="#e8b04b" stroke="#8a5b22" '
        'stroke-width="16"/><text x="256" y="430" text-anchor="middle" '
        'font-family="sans-serif" font-size="30" fill="#2b2923">'
        f"{label}</text></svg>"
    ).encode()


def generate_asset(
    request: GenerateAssetRequest,
    settings: Settings,
    task: AsyncTask | None = None,
) -> dict[str, Any]:
    asset_id = _asset_id(request, settings)
    directory = _cache_dir(settings)
    png_path = directory / f"{asset_id}.png"
    svg_path = directory / f"{asset_id}.svg"
    seed = int(asset_id[:8], 16)

    if not png_path.exists() and not svg_path.exists():
        if settings.image_provider == "fooocus":
            try:
                generate_with_fooocus(request, settings, png_path, seed, task)
            except Exception as error:
                raise ImageGenerationError(str(error)) from error
        elif settings.image_provider == "mock":
            svg_path.write_bytes(_mock_svg(request))
        else:
            raise ImageGenerationError(f"未知图片提供方: {settings.image_provider}")

    is_mock = svg_path.exists()
    result: dict[str, Any] = {
        "asset": {
            "id": asset_id,
            "url": f"/api/assets/{asset_id}",
            "width": request.width,
            "height": request.height,
            "mimeType": "image/svg+xml" if is_mock else "image/png",
            "backgroundRemoved": request.background.value == "transparent" and not is_mock,
            "source": "preset" if is_mock else "generated",
        }
    }
    if not is_mock:
        result["asset"]["generation"] = {
            "provider": "fooocus",
            "mode": request.generation_mode or "standard",
            "prompt": request.prompt,
            "negativePrompt": request.negative_prompt or "",
            "style": request.style or "",
            "seed": seed,
            "width": request.width,
            "height": request.height,
            "steps": settings.default_steps,
            "cfgScale": settings.default_cfg_scale,
            "sampler": settings.default_sampler,
            "pipelineVersion": PIPELINE_VERSION,
        }
    return result


def read_asset(asset_id: str, settings: Settings) -> tuple[bytes, str] | None:
    if not re.fullmatch(r"[a-f0-9]{24}", asset_id):
        return None
    directory = _cache_dir(settings)
    for extension, mime_type in ((".png", "image/png"), (".svg", "image/svg+xml")):
        path = directory / f"{asset_id}{extension}"
        if path.exists():
            return path.read_bytes(), mime_type
    return None
