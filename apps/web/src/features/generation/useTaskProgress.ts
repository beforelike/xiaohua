/**
 * WebSocket 任务进度 Hook
 *
 * 连接后端 WebSocket 端点，实时接收图像生成任务的进度更新。
 * 支持自动重连和状态管理。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** 任务进度事件类型 */
export type TaskEventType =
  | 'progress'
  | 'preview'
  | 'message'
  | 'finish'
  | 'error'

/** 任务进度事件 */
export interface TaskEvent {
  type: TaskEventType
  data: {
    progress?: number
    message?: string
    image?: string
    result?: unknown
    error?: string
  }
}

/** 任务状态 */
export type TaskStatus =
  | 'idle'
  | 'connecting'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Hook 返回值 */
export interface UseTaskProgressReturn {
  /** 当前任务状态 */
  status: TaskStatus
  /** 进度百分比 0-100 */
  progress: number
  /** 最新状态消息 */
  message: string
  /** 预览图 URL/base64 */
  previewImage: string | null
  /** 最终结果 */
  result: unknown | null
  /** 错误信息 */
  error: string | null
  /** 连接到指定任务 */
  connect: (taskId: string) => void
  /** 断开连接 */
  disconnect: () => void
}

const WS_BASE_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`

/**
 * 任务进度 WebSocket Hook
 *
 * 使用示例：
 * ```tsx
 * const { status, progress, connect, disconnect } = useTaskProgress()
 *
 * // 提交任务后连接 WebSocket
 * const handleGenerate = async () => {
 *   const { taskId } = await submitTask(request)
 *   connect(taskId)
 * }
 * ```
 */
export function useTaskProgress(): UseTaskProgressReturn {
  const [status, setStatus] = useState<TaskStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [result, setResult] = useState<unknown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback(
    (taskId: string) => {
      // 清理旧连接
      disconnect()

      // 重置状态
      setStatus('connecting')
      setProgress(0)
      setMessage('')
      setPreviewImage(null)
      setResult(null)
      setError(null)

      const ws = new WebSocket(`${WS_BASE_URL}/ws/tasks/${taskId}`)
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('processing')
      }

      ws.onmessage = (event) => {
        try {
          const taskEvent: TaskEvent = JSON.parse(event.data)

          switch (taskEvent.type) {
            case 'progress':
              if (taskEvent.data.progress !== undefined) {
                setProgress(taskEvent.data.progress)
              }
              if (taskEvent.data.message) {
                setMessage(taskEvent.data.message)
              }
              break

            case 'preview':
              if (taskEvent.data.image) {
                setPreviewImage(taskEvent.data.image)
              }
              break

            case 'message':
              if (taskEvent.data.message) {
                setMessage(taskEvent.data.message)
              }
              break

            case 'finish':
              setStatus('completed')
              setProgress(100)
              setResult(taskEvent.data.result ?? null)
              setMessage('生成完成')
              break

            case 'error':
              setStatus('failed')
              setError(taskEvent.data.error ?? '未知错误')
              break
          }
        } catch {
          console.error('[TaskProgress] 无法解析 WebSocket 消息')
        }
      }

      ws.onerror = () => {
        setStatus('failed')
        setError('WebSocket 连接失败')
      }

      ws.onclose = () => {
        wsRef.current = null
      }
    },
    [disconnect],
  )

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    status,
    progress,
    message,
    previewImage,
    result,
    error,
    connect,
    disconnect,
  }
}
