"""Subprocess entry point for a standard Fooocus text-to-image task."""

import json
import shutil
import sys
import time
from pathlib import Path


def main() -> int:
    payload = json.load(sys.stdin)
    # Importing async_worker starts Fooocus' native worker thread.
    from modules import async_worker, config, flags

    loras = list(config.default_loras[: config.default_max_lora_number])
    while len(loras) < config.default_max_lora_number:
        loras.append((True, "None", 1.0))

    args = [
        False,
        payload["prompt"],
        payload["negative_prompt"],
        payload["styles"],
        payload.get("performance", "Speed"),
        config.default_aspect_ratio,
        1,
        "png",
        payload["seed"],
        False,
        config.default_sample_sharpness,
        payload["cfg_scale"],
        payload["model"],
        payload["refiner"],
        config.default_refiner_switch,
    ]
    for enabled, name, weight in loras:
        args.extend([enabled, name, weight])
    args.extend(
        [
            False,
            "uov",
            flags.disabled,
            None,
            [],
            None,
            "",
            None,
            False,
            False,
            True,
            config.default_black_out_nsfw,
            1.5,
            0.8,
            0.3,
            7.0,
            2,
            payload["sampler"],
            payload["scheduler"],
            "Default (model)",
            payload["steps"],
            -1,
            payload["width"],
            payload["height"],
            -1,
            -1,
            False,
            False,
            False,
            False,
            64,
            128,
            "joint",
            0.25,
            False,
            1.01,
            1.02,
            0.99,
            0.95,
            False,
            False,
            "v2.6",
            1.0,
            0.618,
            False,
            False,
            0,
            False,
            False,
            "fooocus",
        ]
    )
    for _ in range(config.default_controlnet_image_count):
        args.extend([None, 0.5, 0.6, flags.default_ip])
    args.extend([False, 0, False, None, False, flags.disabled, "before", "original"])
    for _ in range(config.default_enhance_tabs):
        args.extend(
            [
                False,
                "",
                "",
                "",
                "sam",
                "full",
                "vit_b",
                0.25,
                0.3,
                0,
                False,
                "v2.6",
                1.0,
                0.618,
                0,
                False,
            ]
        )

    task = async_worker.AsyncTask(args=args)
    async_worker.async_tasks.append(task)
    print("XIAOHUA_PROGRESS 15 Fooocus 任务已提交", flush=True)
    finished = False
    while not finished:
        time.sleep(0.05)
        while task.yields:
            flag, value = task.yields.pop(0)
            if flag == "preview":
                percent, message, _preview = value
                print(f"XIAOHUA_PROGRESS {max(15, min(94, int(percent)))} {message}", flush=True)
            elif flag == "finish":
                finished = True

    if not task.results:
        raise RuntimeError("Fooocus 没有返回生成结果")
    result = Path(task.results[0])
    output = Path(payload["output_path"])
    output.parent.mkdir(parents=True, exist_ok=True)
    if payload.get("transparent"):
        from rembg import remove

        output.write_bytes(remove(result.read_bytes()))
    else:
        shutil.copyfile(result, output)
    print("XIAOHUA_PROGRESS 96 Fooocus 图片已生成", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
