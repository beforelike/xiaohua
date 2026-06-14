/**
 * Python 后端 API 客户端
 *
 * 封装与新 FastAPI 后端的所有 HTTP 通信。
 * 当新后端完全替代旧 TypeScript API 后，此模块将成为唯一的 API 层。
 */

import type { GeneratedAsset } from '@xiaohua/contracts'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

/** 通用请求配置 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.detail || `请求失败: ${response.status}`)
  }

  return response.json()
}

/** 任务提交响应 */
export interface TaskSubmitResponse {
  taskId: string
}

/** 任务状态响应 */
export interface TaskStatusResponse {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  result?: { asset: GeneratedAsset } | null
  error?: string | null
}

/** 预设信息 */
export interface PresetsResponse {
  presets: string[]
  active: string
}

/** 预设详情 */
export interface PresetDetailResponse {
  name: string
  config: Record<string, unknown>
}

// ============ 健康检查 ============

export async function checkHealth(): Promise<{
  status: string
  service: string
  version: string
}> {
  return request('/api/health')
}

// ============ 素材生成 ============

export async function submitGenerateTask(
  body: Record<string, unknown>,
): Promise<TaskSubmitResponse> {
  return request('/api/assets/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function generateAsset(
  body: Record<string, unknown>,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<{ asset: GeneratedAsset }> {
  const initial = await request<TaskSubmitResponse | { asset: GeneratedAsset }>(
    '/api/assets/generate',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
  if ('asset' in initial) return initial

  const pollIntervalMs = options.pollIntervalMs ?? 250
  const timeoutMs = options.timeoutMs ?? 240_000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await getTaskStatus(initial.taskId)
    if (task.status === 'completed' && task.result?.asset) {
      return task.result
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(task.error || '图片生成任务失败')
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs))
  }
  throw new Error('图片生成超时，请稍后重试')
}

export async function getTaskStatus(
  taskId: string,
): Promise<TaskStatusResponse> {
  return request(`/api/assets/tasks/${taskId}`)
}

export async function cancelTask(
  taskId: string,
): Promise<{ taskId: string; cancelled: boolean }> {
  return request(`/api/assets/tasks/${taskId}/cancel`, { method: 'POST' })
}

// ============ 预设 ============

export async function getPresets(): Promise<PresetsResponse> {
  return request('/api/presets')
}

export async function getPresetDetail(
  name: string,
): Promise<PresetDetailResponse> {
  return request(`/api/presets/${name}`)
}

// ============ 命令解析 ============

export async function parseCommand(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return request('/api/commands/parse', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ============ 提示词增强 ============

export async function enhancePrompt(body: {
  prompt: string
  style?: string
  negativePrompt?: string
}): Promise<{ enhancedPrompt: string; enhancedNegative: string }> {
  return request('/api/prompts/enhance', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
