"""Bridge FastAPI generation requests to the local Fooocus runtime."""

import json
import os
import subprocess
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from src.config import Settings
from src.models.generation import GenerateAssetRequest
from src.services.async_worker import AsyncTask


class FooocusError(RuntimeError):
    """Raised when the local Fooocus runtime cannot generate an image."""


@dataclass(frozen=True)
class FooocusRuntimeStatus:
    source_available: bool
    python_available: bool
    checkpoint_available: bool
    source_path: str
    python: str
    checkpoint: str | None
    issues: list[str]

    @property
    def ready(self) -> bool:
        return self.source_available and self.python_available and self.checkpoint_available

    def as_dict(self) -> dict[str, Any]:
        return {
            "ready": self.ready,
            "sourceAvailable": self.source_available,
            "pythonAvailable": self.python_available,
            "checkpointAvailable": self.checkpoint_available,
            "sourcePath": self.source_path,
            "python": self.python,
            "checkpoint": self.checkpoint,
            "issues": self.issues,
        }


def _source_path(settings: Settings) -> Path:
    return Path(settings.fooocus_path).expanduser().resolve()


@lru_cache(maxsize=8)
def _inspect_runtime(source_value: str, python_value: str) -> FooocusRuntimeStatus:
    source = Path(source_value).expanduser().resolve()
    source_available = (source / "modules" / "async_worker.py").is_file()
    python_available = False
    try:
        result = subprocess.run(
            [python_value, "-c", "import torch; print(torch.cuda.is_available())"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        python_available = result.returncode == 0 and result.stdout.strip().endswith("True")
    except (OSError, subprocess.SubprocessError):
        pass

    checkpoints = []
    checkpoint_dir = source / "models" / "checkpoints"
    if checkpoint_dir.is_dir():
        checkpoints = sorted(
            (
                path
                for pattern in ("*.safetensors", "*.ckpt")
                for path in checkpoint_dir.glob(pattern)
                if path.stat().st_size > 1024 * 1024
            ),
            key=lambda path: path.stat().st_size,
            reverse=True,
        )

    issues: list[str] = []
    if not source_available:
        issues.append("Fooocus 源码目录无效")
    if not python_available:
        issues.append("Fooocus Python 未安装可用的 CUDA PyTorch")
    if not checkpoints:
        issues.append("Fooocus models/checkpoints 中没有模型权重")
    return FooocusRuntimeStatus(
        source_available=source_available,
        python_available=python_available,
        checkpoint_available=bool(checkpoints),
        source_path=str(source),
        python=python_value,
        checkpoint=str(checkpoints[0]) if checkpoints else None,
        issues=issues,
    )


def inspect_runtime(settings: Settings) -> FooocusRuntimeStatus:
    return _inspect_runtime(settings.fooocus_path, settings.fooocus_python)


def generate_with_fooocus(
    request: GenerateAssetRequest,
    settings: Settings,
    output_path: Path,
    seed: int,
    task: AsyncTask | None = None,
) -> None:
    status = inspect_runtime(settings)
    if not status.ready:
        raise FooocusError("；".join(status.issues))

    runner = Path(__file__).with_name("fooocus_runner.py")
    payload = {
        "prompt": request.prompt,
        "negative_prompt": request.negative_prompt or "",
        "styles": [request.style] if request.style else settings.default_styles,
        "width": request.width,
        "height": request.height,
        "seed": seed,
        "steps": settings.default_steps,
        "cfg_scale": settings.default_cfg_scale,
        "sampler": settings.default_sampler,
        "scheduler": settings.default_scheduler,
        "model": settings.default_model,
        "refiner": settings.default_refiner,
        "output_path": str(output_path),
        "transparent": request.background.value == "transparent",
    }
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        value for value in [str(_source_path(settings)), env.get("PYTHONPATH", "")] if value
    )
    if task:
        task.push_progress(12, "正在启动本地 Fooocus 推理...")
    process = subprocess.Popen(
        [settings.fooocus_python, str(runner)],
        cwd=_source_path(settings),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(json.dumps(payload, ensure_ascii=False))
    process.stdin.close()

    messages: list[str] = []

    def consume_output() -> None:
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            messages.append(line)
            if line.startswith("XIAOHUA_PROGRESS ") and task:
                _, percent, message = line.split(" ", 2)
                task.push_progress(int(percent), message)

    reader = threading.Thread(target=consume_output, daemon=True)
    reader.start()
    try:
        return_code = process.wait(timeout=settings.fooocus_timeout_seconds)
    except subprocess.TimeoutExpired as error:
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
        raise FooocusError("Fooocus 推理超时") from error
    finally:
        reader.join(timeout=5)

    if return_code != 0 or not output_path.is_file():
        detail = messages[-1] if messages else f"进程退出码 {return_code}"
        raise FooocusError(f"Fooocus 推理失败: {detail}")
