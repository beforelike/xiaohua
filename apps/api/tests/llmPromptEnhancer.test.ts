import { describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../src/config'
import { enhancePrompt } from '../src/services/llmPromptEnhancer'

const config = {
  HOST: '127.0.0.1',
  PORT: 8787,
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 120,
  COMMAND_PROVIDER: 'rules',
  LLM_BASE_URL: 'http://127.0.0.1:11434/v1',
  LLM_MODEL: 'local-model',
  LLM_API_KEY: 'test',
  LLM_ENHANCE_PROMPT: true,
  IMAGE_PROVIDER: 'mock',
  SD_WEBUI_BASE_URL: 'http://127.0.0.1:7860',
  SD_STEPS: 28,
  SD_CFG_SCALE: 7,
  SD_SAMPLER: 'DPM++ 2M Karras',
  SD_DENOISING_STRENGTH: 0.7,
  SD_STYLE_PROMPT: 'storybook',
  ASSET_CACHE_DIR: '.cache/test-assets',
  STATIC_DIR: '',
  ASR_PROVIDER: 'mock',
} satisfies AppConfig

describe('llmPromptEnhancer', () => {
  it('passes project memory and returns separated objects with layout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  style:
                    'photorealistic wildlife photography, natural colors, cinematic daylight',
                  objects: [
                    {
                      name: '草原',
                      prompt: 'wide realistic grassland',
                      negativePrompt: 'animals',
                      background: 'opaque',
                      isBackground: true,
                      position: 'center',
                      size: 'full',
                    },
                    {
                      name: '马',
                      prompt: 'light golden horse galloping',
                      negativePrompt: 'background',
                      background: 'transparent',
                      isBackground: false,
                      position: 'center',
                      size: 'medium',
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await enhancePrompt(
      '画马在草原上奔跑',
      'photorealistic',
      {
        selectedLayerId: 'sun',
        recentLayers: [
          {
            id: 'sun',
            name: '太阳',
            type: 'image',
            prompt: 'warm sunset',
            x: 700,
            y: 40,
            width: 180,
            height: 180,
          },
        ],
        globalStyle: 'photorealistic',
      },
      config,
      fetcher,
    )

    expect(result.objects.map((object) => object.name)).toEqual(['草原', '马'])
    expect(result.style).toContain('photorealistic')
    const requestBody = fetcher.mock.calls[0]?.[1]?.body
    expect(typeof requestBody).toBe('string')
    const body = JSON.parse(requestBody as string) as {
      messages: Array<{ content: string }>
    }
    expect(body.messages[1]?.content).toContain('warm sunset')
    expect(body.messages[1]?.content).toContain('photorealistic')
  })
})
