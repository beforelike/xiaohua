import { describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/config'
import { checkAsrHealth, transcribeAudio } from '../src/services/asrProvider'

const localConfig = {
  HOST: '127.0.0.1',
  PORT: 8787,
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 120,
  COMMAND_PROVIDER: 'rules',
  LLM_ENHANCE_PROMPT: false,
  IMAGE_PROVIDER: 'mock',
  SD_WEBUI_BASE_URL: 'http://127.0.0.1:7860',
  SD_STEPS: 28,
  SD_CFG_SCALE: 7,
  SD_SAMPLER: 'DPM++ 2M Karras',
  SD_DENOISING_STRENGTH: 0.7,
  SD_STYLE_PROMPT: 'digital illustration',
  ASSET_CACHE_DIR: '.cache/test-assets',
  STATIC_DIR: '',
  ASR_PROVIDER: 'local',
  ASR_BASE_URL: 'http://127.0.0.1:9000',
} satisfies AppConfig

describe('ASR provider', () => {
  it('reports local health without exposing the service URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await expect(checkAsrHealth(localConfig, fetcher)).resolves.toEqual({
      provider: 'local',
      available: true,
    })
  })

  it('reports mock mode as unavailable for microphone upload', async () => {
    await expect(
      checkAsrHealth({ ...localConfig, ASR_PROVIDER: 'mock' }),
    ).resolves.toEqual({ provider: 'mock', available: false })
  })

  it('forwards audio to an OpenAI-compatible transcription endpoint', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ text: '  画一棵树  ' }), { status: 200 }),
      )

    await expect(
      transcribeAudio(Buffer.from('audio'), 'audio/webm', localConfig, fetcher),
    ).resolves.toBe('画一棵树')
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:9000/v1/audio/transcriptions',
    )
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData)
  })

  it('rejects empty transcripts and unconfigured providers', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ text: ' ' })))
    await expect(
      transcribeAudio(Buffer.from('audio'), 'audio/webm', localConfig, fetcher),
    ).rejects.toThrow('ASR_EMPTY_TRANSCRIPT')
    await expect(
      transcribeAudio(
        Buffer.from('audio'),
        'audio/webm',
        { ...localConfig, ASR_PROVIDER: 'mock' },
        fetcher,
      ),
    ).rejects.toThrow('ASR_NOT_CONFIGURED')
  })
})
