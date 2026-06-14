"""异步任务队列测试"""

import time

from src.services.async_worker import AsyncTask, TaskFlag, TaskQueue, Worker


class TestAsyncTask:
    """测试 AsyncTask 基本功能"""

    def test_initial_status(self):
        """测试新建任务的初始状态"""
        task = AsyncTask(request={"prompt": "test"})
        assert task.status == "pending"
        assert task.progress == 0
        assert not task.processing
        assert not task.is_cancelled
        assert not task.is_completed

    def test_push_progress(self):
        """测试进度推送"""
        task = AsyncTask()
        task.push_progress(50, "处理中...")
        assert task.progress == 50
        events = task.consume_yields()
        assert len(events) == 1
        assert events[0][0] == TaskFlag.PROGRESS
        assert events[0][1]["progress"] == 50

    def test_push_progress_clamps(self):
        """测试进度值被限制在 0-100"""
        task = AsyncTask()
        task.push_progress(150)
        assert task.progress == 100
        task.push_progress(-10)
        assert task.progress == 0

    def test_finish(self):
        """测试任务完成"""
        task = AsyncTask()
        task.processing = True
        task.finish({"url": "http://example.com/image.png"})
        assert task.is_completed
        assert task.status == "completed"
        assert task.progress == 100
        assert not task.processing

    def test_fail(self):
        """测试任务失败"""
        task = AsyncTask()
        task.processing = True
        task.fail("生成失败：模型未加载")
        assert task.is_completed
        assert task.status == "failed"
        assert task.error == "生成失败：模型未加载"
        assert not task.processing

    def test_cancel(self):
        """测试任务取消"""
        task = AsyncTask()
        task.cancel()
        assert task.is_cancelled
        assert task.last_stop is True

    def test_consume_yields_clears(self):
        """测试消费事件后清空列表"""
        task = AsyncTask()
        task.push_progress(10)
        task.push_progress(20)
        events = task.consume_yields()
        assert len(events) == 2
        # 再次消费应为空
        assert task.consume_yields() == []


class TestTaskQueue:
    """测试任务队列"""

    def test_submit_and_get(self):
        """测试任务提交和获取"""
        queue = TaskQueue()
        task = queue.submit({"prompt": "test"})
        assert queue.get_task(task.task_id) is task
        assert queue.queue_length == 1

    def test_get_nonexistent(self):
        """测试获取不存在的任务"""
        queue = TaskQueue()
        assert queue.get_task("nonexistent-id") is None

    def test_get_next_task(self):
        """测试从队列取出下一个任务"""
        queue = TaskQueue()
        task1 = queue.submit({"prompt": "first"})
        queue.submit({"prompt": "second"})

        next_task = queue.get_next_task()
        assert next_task is task1
        assert next_task.processing is True
        assert queue.queue_length == 1

    def test_cancel_pending_task(self):
        """测试取消未开始的任务"""
        queue = TaskQueue()
        task = queue.submit({"prompt": "cancel me"})
        success = queue.cancel_task(task.task_id)
        assert success is True
        assert queue.queue_length == 0

    def test_cancel_nonexistent(self):
        """测试取消不存在的任务"""
        queue = TaskQueue()
        assert queue.cancel_task("nonexistent") is False

    def test_max_queue_size(self):
        """测试队列容量限制"""
        queue = TaskQueue(max_queue_size=2)
        queue.submit({"prompt": "1"})
        queue.submit({"prompt": "2"})
        import pytest

        with pytest.raises(RuntimeError, match="队列已满"):
            queue.submit({"prompt": "3"})

    def test_cleanup_old_tasks(self):
        """测试清理过期任务"""
        queue = TaskQueue()
        task = queue.submit({"prompt": "old"})
        # 模拟完成并设置很早的创建时间
        next_task = queue.get_next_task()
        assert next_task is not None
        next_task.finish({"result": "done"})
        next_task.created_at = time.time() - 7200  # 2小时前

        cleaned = queue.cleanup_old_tasks(max_age_seconds=3600)
        assert cleaned == 1
        assert queue.get_task(task.task_id) is None


class TestWorker:
    """测试 Worker 线程"""

    def test_worker_processes_task(self):
        """测试 Worker 正确处理任务"""
        queue = TaskQueue()
        processed = []

        def processor(task):
            processed.append(task.task_id)
            task.finish({"done": True})

        worker = Worker(queue=queue, processor=processor, poll_interval=0.05)
        worker.start()

        task = queue.submit({"prompt": "test"})
        time.sleep(0.5)
        worker.stop()

        assert task.task_id in processed
        assert task.status == "completed"

    def test_worker_handles_exception(self):
        """测试 Worker 处理器抛出异常时任务标记为失败"""
        queue = TaskQueue()

        def bad_processor(task):
            raise ValueError("模拟错误")

        worker = Worker(queue=queue, processor=bad_processor, poll_interval=0.05)
        worker.start()

        task = queue.submit({"prompt": "will fail"})
        time.sleep(0.5)
        worker.stop()

        assert task.status == "failed"
        assert "模拟错误" in (task.error or "")

    def test_worker_respects_cancel(self):
        """测试 Worker 尊重取消标志"""
        queue = TaskQueue()

        def slow_processor(task):
            for _i in range(100):
                if task.is_cancelled:
                    task.fail("已取消")
                    return
                time.sleep(0.01)
            task.finish({"done": True})

        worker = Worker(queue=queue, processor=slow_processor, poll_interval=0.05)
        worker.start()

        task = queue.submit({"prompt": "cancel me"})
        time.sleep(0.2)
        task.cancel()
        time.sleep(0.5)
        worker.stop()

        assert task.status == "failed"
        assert "取消" in (task.error or "")
