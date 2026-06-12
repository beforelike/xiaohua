import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { ZodError, z } from 'zod'
import {
  generateAssetRequestSchema,
  parseCommandRequestSchema,
} from '@xiaohua/contracts'
import type { AppConfig } from './config'
import {
  generateAsset,
  ImageGenerationError,
  readAsset,
} from './services/imageGeneration'
import { parseLlmCommand } from './services/llmCommandParser'
import {
  enhancePrompt,
  enhanceSinglePrompt,
} from './services/llmPromptEnhancer'
import { parseRuleCommand } from './services/ruleCommandParser'
import { checkAsrHealth, transcribeAudio } from './services/asrProvider'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface RateLimitBucket {
  windowStartedAt: number
  count: number
}

export function createRateLimitBuckets(
  windowMs: number,
  now: () => number = Date.now,
) {
  const buckets = new Map<string, RateLimitBucket>()
  let nextCleanupAt = now() + windowMs

  return {
    consume(key: string) {
      const currentTime = now()
      if (currentTime >= nextCleanupAt) {
        for (const [bucketKey, bucket] of buckets) {
          if (currentTime - bucket.windowStartedAt >= windowMs) {
            buckets.delete(bucketKey)
          }
        }
        nextCleanupAt = currentTime + windowMs
      }

      const current = buckets.get(key)
      const bucket =
        !current || currentTime - current.windowStartedAt >= windowMs
          ? { windowStartedAt: currentTime, count: 0 }
          : current
      bucket.count += 1
      buckets.set(key, bucket)
      return { bucket, now: currentTime }
    },
    size() {
      return buckets.size
    },
  }
}

export function mapError(error: unknown, requestId: string) {
  const invalidRequest =
    error instanceof SyntaxError || error instanceof ZodError
  const generationError = error instanceof ImageGenerationError

  return {
    status: invalidRequest ? 400 : generationError ? 502 : 500,
    body: {
      error: {
        code: invalidRequest
          ? 'INVALID_REQUEST'
          : generationError
            ? 'GENERATION_FAILED'
            : 'INTERNAL_ERROR',
        message: invalidRequest
          ? '请求内容不合法'
          : generationError
            ? error.message
            : '服务暂时不可用',
        retryable: !invalidRequest,
        requestId,
      },
    },
  } as const
}

export function createApp(config: AppConfig) {
  const app = express()
  const rateLimitBuckets = createRateLimitBuckets(config.RATE_LIMIT_WINDOW_MS)
  const allowedWebOrigins = new Set(
    config.WEB_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )

  app.disable('x-powered-by')
  const requestId: RequestHandler = (request, response, next) => {
    response.locals.requestId =
      request.header('x-request-id')?.slice(0, 100) ?? randomUUID()
    response.setHeader('x-request-id', response.locals.requestId as string)
    next()
  }
  app.use(requestId)
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || allowedWebOrigins.has(origin))
      },
    }),
  )
  app.use((request, response, next) => {
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown'
    const { bucket, now } = rateLimitBuckets.consume(key)

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
      llmConfigured: Boolean(
        config.LLM_BASE_URL && config.LLM_MODEL && config.LLM_API_KEY,
      ),
      llmEnhancePrompt: config.LLM_ENHANCE_PROMPT,
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
      const llmConfigured = Boolean(
        config.LLM_BASE_URL && config.LLM_MODEL && config.LLM_API_KEY,
      )
      let command =
        ruleCommand ??
        (config.COMMAND_PROVIDER !== 'mock' && llmConfigured
          ? await parseLlmCommand(input, config)
          : null)

      // 所有创建命令都统一经过同一套增强器。命令解析 LLM 返回的 objects
      // 只用于语义理解，不能绕过更严格的图层职责和提示词净化。
      if (
        command &&
        command.action === 'create' &&
        config.LLM_ENHANCE_PROMPT &&
        config.LLM_BASE_URL &&
        config.LLM_MODEL &&
        config.LLM_API_KEY
      ) {
        try {
          const enhanced = await enhancePrompt(
            command.prompt ?? input.text,
            input.context.globalStyle,
            input.context,
            config,
          )
          if (enhanced.objects.length > 0) {
            command = {
              ...command,
              style: enhanced.style,
              objects: enhanced.objects,
            }
          }
        } catch {
          response.status(502).json({
            error: {
              code: 'GENERATION_FAILED',
              message: '提示词增强服务超时或不可用，请稍后重试',
              retryable: true,
              requestId: response.locals.requestId as string,
            },
          })
          return
        }
      }

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

  // 提示词增强端点：单独用于重新生成场景
  app.post('/api/prompts/enhance', async (request, response, next) => {
    try {
      const body = z
        .object({
          prompt: z.string().min(1).max(500),
          globalStyle: z.string().max(500).default(''),
        })
        .parse(request.body)

      if (!config.LLM_BASE_URL || !config.LLM_MODEL || !config.LLM_API_KEY) {
        response.status(503).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'LLM 未配置，无法增强提示词',
            retryable: false,
            requestId: response.locals.requestId as string,
          },
        })
        return
      }

      const result = await enhancePrompt(
        body.prompt,
        body.globalStyle,
        {
          selectedLayerId: null,
          recentLayers: [],
          globalStyle: body.globalStyle,
        },
        config,
      )
      response.json(result)
    } catch (error) {
      next(error)
    }
  })

  // 单对象提示词增强端点
  app.post('/api/prompts/enhance-single', async (request, response, next) => {
    try {
      const body = z
        .object({
          objectName: z.string().min(1).max(80),
          prompt: z.string().min(1).max(500),
          background: z.enum(['transparent', 'opaque']),
          globalStyle: z.string().max(500).default(''),
        })
        .parse(request.body)

      if (!config.LLM_BASE_URL || !config.LLM_MODEL || !config.LLM_API_KEY) {
        response.status(503).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'LLM 未配置，无法增强提示词',
            retryable: false,
            requestId: response.locals.requestId as string,
          },
        })
        return
      }

      const result = await enhanceSinglePrompt(
        body.objectName,
        body.prompt,
        body.background,
        body.globalStyle,
        config,
      )
      response.json(result)
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

  // Serve web frontend static files
  const staticDir = config.STATIC_DIR
    ? path.resolve(config.STATIC_DIR)
    : path.resolve(__dirname, '..', '..', 'web', 'dist')

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir))
    // SPA fallback: serve index.html for non-API GET requests
    app.use((request, response, next) => {
      if (request.method === 'GET' && !request.path.startsWith('/api/')) {
        response.sendFile(path.join(staticDir, 'index.html'))
      } else {
        next()
      }
    })
  }

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
