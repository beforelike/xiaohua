"""CLI 参数管理

参考 Fooocus args_manager.py，定义命令行启动参数。
CLI 参数具有最高优先级，覆盖所有其他配置来源。
"""

import argparse
from typing import Any


def parse_args() -> argparse.Namespace:
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="笑画 AI 绘画后端",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # 服务参数
    parser.add_argument("--host", type=str, default=None, help="监听地址")
    parser.add_argument("--port", type=int, default=None, help="监听端口")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")

    # 模型参数
    parser.add_argument("--preset", type=str, default=None, help="预设名称")
    parser.add_argument("--model-path", type=str, default=None, help="模型文件根目录")

    # 分享与安全
    parser.add_argument("--share", action="store_true", help="启用公网分享（通过 ngrok）")
    parser.add_argument(
        "--cors-origins",
        type=str,
        nargs="*",
        default=None,
        help="允许的跨域来源列表",
    )

    return parser.parse_args()


def args_to_env_overrides(args: argparse.Namespace) -> dict[str, Any]:
    """将 CLI 参数转换为环境变量覆盖字典

    仅包含用户显式指定的参数（非 None 值），
    用于覆盖 Settings 中的默认值。

    Returns:
        键值对字典，键使用 Settings 字段名
    """
    overrides: dict[str, Any] = {}

    if args.host is not None:
        overrides["host"] = args.host
    if args.port is not None:
        overrides["port"] = args.port
    if args.debug:
        overrides["debug"] = True
    if args.preset is not None:
        overrides["preset"] = args.preset
    if args.model_path is not None:
        overrides["model_base_path"] = args.model_path
    if args.cors_origins is not None:
        overrides["cors_origins"] = args.cors_origins

    return overrides
