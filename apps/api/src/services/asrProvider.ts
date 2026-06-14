import type { AppConfig } from '../config'

interface TranscriptionResponse {
  text?: string
}

export interface AsrHealth {
  provider: AppConfig['ASR_PROVIDER']
  available: boolean
}

export async function checkAsrHealth(
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<AsrHealth> {
  if (config.ASR_PROVIDER === 'mock' || !config.ASR_BASE_URL) {
    return { provider: config.ASR_PROVIDER, available: false }
  }
  try {
    const response = await fetcher(
      `${config.ASR_BASE_URL.replace(/\/$/, '')}/health`,
      { signal: AbortSignal.timeout(3000) },
    )
    return { provider: config.ASR_PROVIDER, available: response.ok }
  } catch {
    return { provider: config.ASR_PROVIDER, available: false }
  }
}

export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (config.ASR_PROVIDER !== 'local' || !config.ASR_BASE_URL) {
    throw new Error('ASR_NOT_CONFIGURED')
  }
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(audio)], { type: mimeType }),
    mimeType.includes('wav') ? 'voice.wav' : 'voice.webm',
  )
  form.append('model', 'whisper-1')
  form.append('language', 'zh')
  const response = await fetcher(
    `${config.ASR_BASE_URL.replace(/\/$/, '')}/v1/audio/transcriptions`,
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    },
  )
  if (!response.ok) {
    throw new Error(`ASR_HTTP_${String(response.status)}`)
  }
  const payload = (await response.json()) as TranscriptionResponse
  const text = payload.text?.trim()
  if (!text) throw new Error('ASR_EMPTY_TRANSCRIPT')
  return text
}
