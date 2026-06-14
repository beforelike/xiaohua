"""异步任务队列

参考 Fooocus modules/async_worker.py 实现异步任务队列与 Worker 线程。
支持任务提交、取消、进度推送和状态查询。
"""

import logging
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class TaskFlag(str, Enum):
    """任务进度事件标志"""

    PROGRESS = "progress"
    PREVIEW = "preview"
    MESSAGE = "message"
    FINISH = "finish"
    ERROR = "error"


@dataclass
class AsyncTask:
    """异步生成任务

    模仿 Fooocus 的 AsyncTask 设计：
    - yields: 进度事件队列，worker 生产，WebSocket 消费
    - results: 最终生成结果
    - processing: 标记当前是否正在处理
    - last_stop: 中断标志，设为 True 时 worker 应尽快停止

    Attributes:
        task_id: 唯一任务标识
        request: 原始生成请求数据
        yields: 进度事件列表 [(flag, data), ...]
        results: 生成结果列表
        processing: 是否正在处理
        last_stop: 中断标志
        progress: 进度百分比 0-100
        error: 错误信息
        created_at: 创建时间戳
    """

    task_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    request: dict[str, Any] = field(default_factory=dict)
    yields: list[tuple[TaskFlag, Any]] = field(default_factory=list)
    results: list[Any] = field(default_factory=list)
    processing: bool = False
    last_stop: bool = False
    progress: int = 0
    error: str | None = None
    created_at: float = field(default_factory=time.time)

    def push_progress(self, progress: int, message: str = "") -> None:
        """推送进度更新"""
        self.progress = max(0, min(100, progress))
        self.yields.append((TaskFlag.PROGRESS, {"progress": self.progress, "message": message}))

    def push_preview(self, image_data: str) -> None:
        """推送预览图像（base64 或 URL）"""
        self.yields.append((TaskFlag.PREVIEW, {"image": image_data}))

    def push_message(self, message: str) -> None:
        """推送状态消息"""
        self.yields.append((TaskFlag.MESSAGE, {"message": message}))

    def finish(self, result: Any) -> None:
        """标记任务完成"""
        self.results.append(result)
        self.progress = 100
        self.processing = False
        self.yields.append((TaskFlag.FINISH, {"result": result}))

    def fail(self, error: str) -> None:
        """标记任务失败"""
        self.error = error
        self.processing = False
        self.yields.append((TaskFlag.ERROR, {"error": error}))

    def cancel(self) -> None:
        """请求取消任务"""
        self.last_stop = True

    @property
    def is_cancelled(self) -> bool:
        """检查是否已请求取消"""
        return self.last_stop

    @property
    def is_completed(self) -> bool:
        """检查任务是否已完成（成功或失败）"""
        return len(self.results) > 0 or self.error is not None

    @property
    def status(self) -> str:
        """获取当前状态字符串"""
        if self.error:
            return "failed"
        if self.last_stop and not self.processing:
            return "cancelled"
        if self.results:
            return "completed"
        if self.processing:
            return "processing"
        return "pending"

    def consume_yields(self) -> list[tuple[TaskFlag, Any]]:
        """消费并清空待发送的进度事件

        Returns:
            消费的事件列表
        """
        events = self.yields[:]
        self.yields.clear()
        return events


# 任务处理函数类型：接收 AsyncTask，执行实际推理逻辑
TaskProcessor = Callable[[AsyncTask], None]


class TaskQueue:
    """异步任务队列管理器

    管理任务的提交、查询和取消。Worker 线程从队列中消费任务。
    """

    def __init__(self, max_queue_size: int = 100) -> None:
        self._tasks: dict[str, AsyncTask] = {}
        self._queue: list[str] = []  # 待处理任务 ID 队列
        self._lock = threading.Lock()
        self._max_queue_size = max_queue_size

    def submit(self, request: dict[str, Any]) -> AsyncTask:
        """提交新任务到队列

        Args:
            request: 生成请求数据

        Returns:
            创建的 AsyncTask 实例

        Raises:
            RuntimeError: 队列已满时抛出
        """
        with self._lock:
            if len(self._queue) >= self._max_queue_size:
                raise RuntimeError(f"任务队列已满（最大 {self._max_queue_size} 个），请稍后重试")

            task = AsyncTask(request=request)
            self._tasks[task.task_id] = task
            self._queue.append(task.task_id)
            logger.info("任务已提交: %s (队列长度: %d)", task.task_id, len(self._queue))
            return task

    def get_task(self, task_id: str) -> AsyncTask | None:
        """获取任务实例"""
        return self._tasks.get(task_id)

    def cancel_task(self, task_id: str) -> bool:
        """取消任务

        Args:
            task_id: 任务 ID

        Returns:
            是否成功取消（任务存在且未完成）
        """
        task = self._tasks.get(task_id)
        if task is None:
            return False
        if task.is_completed:
            return False
        task.cancel()

        # 如果任务还在队列中（未开始处理），直接移除
        with self._lock:
            if task_id in self._queue:
                self._queue.remove(task_id)
                task.fail("任务已被用户取消")
        return True

    def get_next_task(self) -> AsyncTask | None:
        """从队列取出下一个待处理任务（Worker 调用）

        Returns:
            下一个待处理任务，队列为空时返回 None
        """
        with self._lock:
            while self._queue:
                task_id = self._queue.pop(0)
                task = self._tasks.get(task_id)
                if task and not task.is_cancelled:
                    task.processing = True
                    return task
            return None

    def cleanup_old_tasks(self, max_age_seconds: float = 3600) -> int:
        """清理超时的已完成任务

        Args:
            max_age_seconds: 任务最大保留时间（秒）

        Returns:
            清理的任务数量
        """
        now = time.time()
        to_remove: list[str] = []

        with self._lock:
            for task_id, task in self._tasks.items():
                if task.is_completed and (now - task.created_at) > max_age_seconds:
                    to_remove.append(task_id)

            for task_id in to_remove:
                del self._tasks[task_id]

        if to_remove:
            logger.info("已清理 %d 个过期任务", len(to_remove))
        return len(to_remove)

    @property
    def queue_length(self) -> int:
        """当前待处理队列长度"""
        return len(self._queue)

    @property
    def total_tasks(self) -> int:
        """所有任务总数（包括已完成的）"""
        return len(self._tasks)


class Worker:
    """后台 Worker 线程

    持续从 TaskQueue 消费任务，调用 processor 处理。
    """

    def __init__(
        self,
        queue: TaskQueue,
        processor: TaskProcessor,
        poll_interval: float = 0.5,
    ) -> None:
        """
        Args:
            queue: 任务队列
            processor: 任务处理函数
            poll_interval: 队列为空时的轮询间隔（秒）
        """
        self._queue = queue
        self._processor = processor
        self._poll_interval = poll_interval
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """启动 Worker 线程"""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="async-worker")
        self._thread.start()
        logger.info("Worker 线程已启动")

    def stop(self) -> None:
        """停止 Worker 线程"""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        logger.info("Worker 线程已停止")

    def _run(self) -> None:
        """Worker 主循环"""
        while self._running:
            task = self._queue.get_next_task()
            if task is None:
                time.sleep(self._poll_interval)
                continue

            logger.info("开始处理任务: %s", task.task_id)
            try:
                self._processor(task)
                if not task.is_completed:
                    task.finish(task.results[-1] if task.results else None)
            except Exception as e:
                error_msg = f"任务处理异常: {e}"
                logger.exception(error_msg)
                task.fail(error_msg)
            finally:
                task.processing = False
                logger.info("任务处理完成: %s (状态: %s)", task.task_id, task.status)


# 全局任务队列实例（应用生命周期内单例）
_task_queue: TaskQueue | None = None
_worker: Worker | None = None


def get_task_queue() -> TaskQueue:
    """获取全局任务队列单例"""
    global _task_queue
    if _task_queue is None:
        _task_queue = TaskQueue()
    return _task_queue


def start_worker(processor: TaskProcessor) -> Worker:
    """启动全局 Worker

    Args:
        processor: 任务处理函数

    Returns:
        Worker 实例
    """
    global _worker
    queue = get_task_queue()
    _worker = Worker(queue=queue, processor=processor)
    _worker.start()
    return _worker


def stop_worker() -> None:
    """停止全局 Worker"""
    global _worker
    if _worker:
        _worker.stop()
        _worker = None
