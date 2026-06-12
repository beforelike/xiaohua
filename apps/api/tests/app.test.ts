import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiErrorSchema, drawingCommandSchema } from '@xiaohua/contracts'
import { z } from 'zod'
import { createApp, createRateLimitBuckets, mapError } from '../src/app'
import { getConfig, rootEnvPath } from '../src/config'

const config = getConfig({
  HOST: '127.0.0.1',
  PORT: '8787',
  WEB_ORIGIN: 'http://127.0.0.1:5173,http://127.0.0.1:5174',
  COMMAND_PROVIDER: 'mock',
  IMAGE_PROVIDER: 'mock',
  ASR_PROVIDER: 'mock',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API application', () => {
  it('defaults local development to WebUI generation and both Vite origins', () => {
    const defaults = getConfig({})

    expect(defaults.IMAGE_PROVIDER).toBe('stable-diffusion-webui')
    expect(defaults.WEB_ORIGIN.split(',')).toEqual([
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
    ])
  })

  it('loads the repository root environment independently of process cwd', () => {
    expect(rootEnvPath).toBe(
      path.resolve(import.meta.dirname, '../../..', '.env'),
    )
  })

  it('returns provider-safe health information', async () => {
    const response = await request(createApp(config)).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'ok',
      commandProvider: 'mock',
      imageProvider: 'mock',
      asrProvider: 'mock',
    })
    expect(response.body).not.toHaveProperty('apiKey')
  })

  it('returns a structured error for unknown routes', async () => {
    const response = await request(createApp(config))
      .get('/api/missing')
      .set('x-request-id', 'client-request-1')
    const body = apiErrorSchema.parse(response.body)

    expect(response.status).toBe(404)
    expect(body.error).toMatchObject({
      code: 'INVALID_REQUEST',
      message: '请求的接口不存在',
      retryable: false,
    })
    expect(body.error.requestId).toBe('client-request-1')
  })

  it('rejects malformed JSON without leaking implementation details', async () => {
    const response = await request(createApp(config))
      .post('/api/anything')
      .set('content-type', 'application/json')
      .send('{"broken"')
    const body = apiErrorSchema.parse(response.body)

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('INVALID_REQUEST')
    expect(JSON.stringify(body)).not.toContain('SyntaxError')
  })

  it('rate limits clients with a structured retryable error', async () => {
    const app = createApp({ ...config, RATE_LIMIT_MAX: 1 })
    await request(app).get('/api/health').expect(200)
    const response = await request(app)
      .get('/api/health')
      .set('x-request-id', 'limited-request')
      .set('origin', 'http://127.0.0.1:5174')
    const body = apiErrorSchema.parse(response.body)

    expect(response.status).toBe(429)
    expect(response.headers['retry-after']).toBe('60')
    expect(response.headers['x-ratelimit-remaining']).toBe('0')
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:5174',
    )
    expect(body.error).toEqual({
      code: 'PROVIDER_LIMIT',
      message: '请求过于频繁，请稍后重试',
      retryable: true,
      requestId: 'limited-request',
    })
  })

  it('does not grant CORS access to unconfigured origins', async () => {
    const response = await request(createApp(config))
      .get('/api/health')
      .set('origin', 'http://example.com')

    expect(response.status).toBe(200)
    expect(response.headers).not.toHaveProperty('access-control-allow-origin')
  })

  it('removes expired rate limit buckets during lazy cleanup', () => {
    let now = 0
    const buckets = createRateLimitBuckets(1_000, () => now)

    buckets.consume('client-1')
    now = 500
    buckets.consume('client-2')
    expect(buckets.size()).toBe(2)

    now = 1_000
    buckets.consume('client-3')
    expect(buckets.size()).toBe(2)
  })

  it('maps validation and internal errors without leaking details', () => {
    const validation = z.string().safeParse(42)
    expect(validation.success).toBe(false)
    if (validation.success) {
      throw new Error('测试数据应产生校验错误')
    }
    const validationResult = mapError(validation.error, 'validation-request')
    const internalResult = mapError(new Error('secret'), 'internal-request')

    expect(validationResult.status).toBe(400)
    expect(validationResult.body.error.code).toBe('INVALID_REQUEST')
    expect(internalResult).toEqual({
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务暂时不可用',
          retryable: true,
          requestId: 'internal-request',
        },
      },
    })
  })

  it('enhances rule-matched create commands instead of bypassing the LLM', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  style:
                    'soft hand-painted storybook illustration, warm colors',
                  objects: [
                    {
                      name: '太阳',
                      prompt: 'warm hand-painted sun',
                      negativePrompt: 'text, watermark',
                      background: 'transparent',
                      isBackground: false,
                      position: 'top-right',
                      size: 'small',
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
    vi.stubGlobal('fetch', fetcher)
    const llmConfig = getConfig({
      HOST: '127.0.0.1',
      PORT: '8787',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      COMMAND_PROVIDER: 'rules',
      LLM_BASE_URL: 'http://127.0.0.1:11434/v1',
      LLM_MODEL: 'local-model',
      LLM_API_KEY: 'test',
      LLM_ENHANCE_PROMPT: 'true',
      IMAGE_PROVIDER: 'mock',
      ASR_PROVIDER: 'mock',
    })

    const response = await request(createApp(llmConfig))
      .post('/api/commands/parse')
      .send({
        schemaVersion: 1,
        text: '画一个太阳',
        context: {
          selectedLayerId: null,
          recentLayers: [],
          globalStyle: 'storybook',
        },
      })

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledOnce()
    const body = z
      .object({ command: drawingCommandSchema })
      .parse(response.body)
    expect(body.command.objects).toEqual([
      expect.objectContaining({
        name: '太阳',
        prompt: 'warm hand-painted sun',
        position: 'top-right',
      }),
    ])
    expect(body.command.style).toContain('storybook')
  })
})
