"""FastAPI 应用入口

笑画 AI 绘画后端 - 本地 SDXL 推理服务。
提供语音驱动的 AI 绘画能力，支持异步任务队列与 WebSocket 进度推送。
"""

import asyncio
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.config import get_settings
from src.models.generation import GenerateAssetRequest
from src.routers import asr, assets, commands, health, prompts
from src.services.async_worker import get_task_queue, start_worker, stop_worker
from src.services.image_generation import generate_asset


def _generate_processor(task):  # type: ignore[no-untyped-def]
    """Validate, generate, and persist one queued image asset."""
    settings = get_settings()
    request = GenerateAssetRequest.model_validate(task.request)
    if task.is_cancelled:
        task.fail("任务已被用户取消")
        return
    task.finish(generate_asset(request, settings, task))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """应用生命周期管理：启动时初始化资源，关闭时释放资源"""
    settings = get_settings()
    print(f"[启动] 笑画 API 服务 v0.1.0 | 端口: {settings.port}")
    print(f"[启动] 模型路径: {settings.model_base_path}")
    # 启动 Worker 线程
    start_worker(_generate_processor)
    print("[启动] Worker 线程已就绪")
    yield
    # 停止 Worker
    stop_worker()
    print("[关闭] 资源已清理")


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用实例"""
    settings = get_settings()

    app = FastAPI(
        title="笑画 AI 绘画 API",
        version="0.1.0",
        description="语音驱动的 AI 绘画后端，基于本地 SDXL 推理",
        lifespan=lifespan,
    )

    # CORS 中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 请求 ID 中间件
    @app.middleware("http")
    async def add_request_id(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    # 注册路由
    app.include_router(health.router, prefix="/api", tags=["健康检查"])
    app.include_router(commands.router, prefix="/api/commands", tags=["命令解析"])
    app.include_router(assets.router, prefix="/api/assets", tags=["素材生成"])
    app.include_router(prompts.router, prefix="/api/prompts", tags=["提示词"])
    app.include_router(asr.router, prefix="/api/asr", tags=["语音识别"])

    # WebSocket 进度推送端点
    @app.websocket("/ws/tasks/{task_id}")
    async def websocket_task_progress(websocket: WebSocket, task_id: str) -> None:
        """任务进度 WebSocket 端点

        客户端连接后实时接收任务进度事件，包括：
        - progress: 进度百分比和状态消息
        - preview: 中间预览图
        - finish: 完成结果
        - error: 错误信息
        """
        await websocket.accept()
        queue = get_task_queue()
        task = queue.get_task(task_id)

        if task is None:
            await websocket.send_json(
                {"type": "error", "data": {"error": f"任务 {task_id} 不存在"}}
            )
            await websocket.close()
            return

        try:
            # 持续推送进度事件直到任务完成
            while not task.is_completed:
                events = task.consume_yields()
                for flag, data in events:
                    await websocket.send_json({"type": flag.value, "data": data})
                if not events:
                    await asyncio.sleep(0.1)

            # 发送剩余事件
            for flag, data in task.consume_yields():
                await websocket.send_json({"type": flag.value, "data": data})

        except WebSocketDisconnect:
            pass
        finally:
            await websocket.close()

    web_dist = Path(__file__).resolve().parents[2] / "web" / "dist"
    if web_dist.exists():
        assets_dir = web_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="web-assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def serve_web(path: str) -> FileResponse:
            if path.startswith(("api/", "ws/")):
                raise HTTPException(status_code=404, detail="接口不存在")
            candidate = (web_dist / path).resolve()
            if path and candidate.is_relative_to(web_dist.resolve()) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(web_dist / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
