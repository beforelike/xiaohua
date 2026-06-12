import {
  drawingCommandSchema,
  type DrawingCommand,
  type ParseCommandRequest,
} from '@xiaohua/contracts'
import type { AppConfig } from '../config'

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

export async function parseLlmCommand(
  request: ParseCommandRequest,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<DrawingCommand> {
  if (!config.LLM_BASE_URL || !config.LLM_MODEL || !config.LLM_API_KEY) {
    throw new Error('LLM_NOT_CONFIGURED')
  }

  const response = await fetcher(
    `${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '将中文绘图指令转换为 DrawingCommand JSON。只输出 JSON；schemaVersion 必须为 1；action 只能是 create/select/modify/delete/reorder/rename/save/confirm/cancel；confidence 为 0 到 1。',
          },
          {
            role: 'user',
            content: JSON.stringify(request),
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (!response.ok) throw new Error(`LLM_HTTP_${String(response.status)}`)
  const payload = (await response.json()) as ChatCompletion
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM_EMPTY_RESPONSE')

  return drawingCommandSchema.parse(JSON.parse(content))
}
