"""素材生成路由

提供图像素材的异步生成接口，包含任务提交、状态查询和取消。
"""

from fastapi import APIRouter, HTTPException, Request

from src.models.generation import (
    GenerateAssetRequest,
    TaskStatus,
    TaskStatusResponse,
    TaskSubmitResponse,
)
from src.services.async_worker import get_task_queue

router = APIRouter()


@router.post("/generate")
async def generate_asset(
    request: Request,
    body: GenerateAssetRequest,
) -> TaskSubmitResponse:
    """提交素材生成任务

    接收生成请求，加入异步任务队列，立即返回任务 ID。
    客户端通过 WebSocket 或轮询获取进度和结果。

    Args:
        body: 素材生成请求参数

    Returns:
        TaskSubmitResponse: 包含任务 ID
    """
    queue = get_task_queue()
    try:
        task = queue.submit(body.model_dump(by_alias=True))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return TaskSubmitResponse(taskId=task.task_id)


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str) -> TaskStatusResponse:
    """查询任务状态

    Args:
        task_id: 任务 ID

    Returns:
        TaskStatusResponse: 任务当前状态和进度
    """
    queue = get_task_queue()
    task = queue.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"任务 {task_id} 不存在")

    status_map = {
        "pending": TaskStatus.PENDING,
        "processing": TaskStatus.PROCESSING,
        "completed": TaskStatus.COMPLETED,
        "failed": TaskStatus.FAILED,
        "cancelled": TaskStatus.CANCELLED,
    }

    return TaskStatusResponse(
        taskId=task.task_id,
        status=status_map.get(task.status, TaskStatus.PENDING),
        progress=task.progress,
        error=task.error,
    )


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str) -> dict[str, str | bool]:
    """取消生成任务

    Args:
        task_id: 任务 ID

    Returns:
        取消结果
    """
    queue = get_task_queue()
    success = queue.cancel_task(task_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"任务 {task_id} 不存在或已完成，无法取消",
        )
    return {"taskId": task_id, "cancelled": True}
