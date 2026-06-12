import { randomUUID } from 'node:crypto'
import cors from 'cors'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { ZodError } from 'zod'
import {
  generateAssetRequestSchema,
  parseCommandRequestSchema,
} from '@xiaohua/contracts'
import type { AppConfig } from './config'
import { generateAsset, readAsset } from './services/imageGeneration'
import { parseLlmCommand } from './services/llmCommandParser'
import { parseRuleCommand } from './services/ruleCommandParser'
import { checkAsrHealth, transcribeAudio } from './services/asrProvider'

export function mapError(error: unknown, requestId: string) {
  const invalidRequest =
    error instanceof SyntaxError || error instanceof ZodError

  return {
    status: invalidRequest ? 400 : 500,
    body: {
      error: {
        code: invalidRequest ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        message: invalidRequest ? '请求内容不合法' : '服务暂时不可用',
        retryable: !invalidRequest,
        requestId,
      },
    },
  } as const
}

export function createApp(config: AppConfig) {
  const app = express()
  const rateLimitBuckets = new Map<
    string,
    { windowStartedAt: number; count: number }
  >()

  app.disable('x-powered-by')
  const requestId: RequestHandler = (request, response, next) => {
    response.locals.requestId =
      request.header('x-request-id')?.slice(0, 100) ?? randomUUID()
    response.setHeader('x-request-id', response.locals.requestId as string)
    next()
  }
  app.use(requestId)
  app.use(cors({ origin: config.WEB_ORIGIN }))
  app.use((request, response, next) => {
    const now = Date.now()
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown'
    const current = rateLimitBuckets.get(key)
    const bucket =
      !current || now - current.windowStartedAt >= config.RATE_LIMIT_WINDOW_MS
        ? { windowStartedAt: now, count: 0 }
        : current
    bucket.count += 1
    rateLimitBuckets.set(key, bucket)

    const remaining = Math.max(config.RATE_LIMIT_MAX - bucket.count, 0)
    response.setHeader('x-ratelimit-limit', config.RATE_LIMIT_MAX)
    response.setHeader('x-ratelimit-remaining', remaining)
    if (bucket.count > config.RATE_LIMIT_MAX) {
      const retryAfterSeconds = Math.max(
        Math.ceil(
          (config.RATE_LIMIT_WINDOW_MS - (now - bucket.windowStartedAt)) / 1000,
        ),
        1,
      )
      response.setHeader('retry-after', retryAfterSeconds)
      response.status(429).json({
        error: {
          code: 'PROVIDER_LIMIT',
          message: '请求过于频繁，请稍后重试',
          retryable: true,
          requestId: response.locals.requestId as string,
        },
      })
      return
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      commandProvider: config.COMMAND_PROVIDER,
      imageProvider: config.IMAGE_PROVIDER,
      asrProvider: config.ASR_PROVIDER,
    })
  })

  app.get('/api/asr/health', async (_request, response, next) => {
    try {
      response.json(await checkAsrHealth(config))
    } catch (error) {
      next(error)
    }
  })

  app.post(
    '/api/asr/transcribe',
    express.raw({
      type: ['audio/*', 'application/octet-stream'],
      limit: '25mb',
    }),
    async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          response.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message: '没有收到可识别的音频',
              retryable: false,
              requestId: response.locals.requestId as string,
            },
          })
          return
        }
        const text = await transcribeAudio(
          request.body,
          request.header('content-type') ?? 'audio/webm',
          config,
        )
        response.json({ text })
      } catch (error) {
        next(error)
      }
    },
  )

  app.post('/api/commands/parse', async (request, response, next) => {
    try {
      const input = parseCommandRequestSchema.parse(request.body)
      const ruleCommand = parseRuleCommand(input)
      const command =
        ruleCommand ??
        (config.COMMAND_PROVIDER === 'llm'
          ? await parseLlmCommand(input, config)
          : null)
      if (!command) {
        response.status(422).json({
          error: {
            code: 'UNSUPPORTED_COMMAND',
            message: '暂时无法理解这条指令，请换一种说法',
            retryable: false,
            requestId: response.locals.requestId as string,
          },
        })
        return
      }
      response.json({ command })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/assets/generate', async (request, response, next) => {
    try {
      const input = generateAssetRequestSchema.parse(request.body)
      response.json({ asset: await generateAsset(input, config) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/assets/:id', async (request, response, next) => {
    try {
      const asset = await readAsset(config.ASSET_CACHE_DIR, request.params.id)
      if (!asset) {
        response.status(404).json({
          error: {
            code: 'INVALID_REQUEST',
            message: '素材不存在',
            retryable: false,
            requestId: response.locals.requestId as string,
          },
        })
        return
      }
      response
        .set({
          'content-type': asset.mimeType,
          'cache-control': 'private, max-age=86400',
        })
        .send(asset.body)
    } catch (error) {
      next(error)
    }
  })

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'INVALID_REQUEST',
        message: '请求的接口不存在',
        retryable: false,
        requestId: response.locals.requestId as string,
      },
    })
  })

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const result = mapError(error, response.locals.requestId as string)
    response.status(result.status).json(result.body)
  }
  app.use(errorHandler)

  return app
}
