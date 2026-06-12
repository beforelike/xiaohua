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

  app.disable('x-powered-by')
  const requestId: RequestHandler = (request, response, next) => {
    response.locals.requestId =
      request.header('x-request-id')?.slice(0, 100) ?? randomUUID()
    response.setHeader('x-request-id', response.locals.requestId as string)
    next()
  }
  app.use(requestId)
  app.use(cors({ origin: config.WEB_ORIGIN }))
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      commandProvider: config.COMMAND_PROVIDER,
      imageProvider: config.IMAGE_PROVIDER,
      asrProvider: config.ASR_PROVIDER,
    })
  })

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
