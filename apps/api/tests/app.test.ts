import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { apiErrorSchema } from '@xiaohua/contracts'
import { z } from 'zod'
import { createApp, mapError } from '../src/app'
import { getConfig } from '../src/config'

const config = getConfig({
  HOST: '127.0.0.1',
  PORT: '8787',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  COMMAND_PROVIDER: 'mock',
  IMAGE_PROVIDER: 'mock',
  ASR_PROVIDER: 'mock',
})

describe('API application', () => {
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
      .set('origin', config.WEB_ORIGIN)
    const body = apiErrorSchema.parse(response.body)

    expect(response.status).toBe(429)
    expect(response.headers['retry-after']).toBe('60')
    expect(response.headers['x-ratelimit-remaining']).toBe('0')
    expect(response.headers['access-control-allow-origin']).toBe(
      config.WEB_ORIGIN,
    )
    expect(body.error).toEqual({
      code: 'PROVIDER_LIMIT',
      message: '请求过于频繁，请稍后重试',
      retryable: true,
      requestId: 'limited-request',
    })
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
})
