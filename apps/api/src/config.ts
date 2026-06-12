import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

loadDotEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true })

const optionalUrl = z.url().optional()
const webOrigins = z.string().superRefine((value, context) => {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'WEB_ORIGIN must contain at least one URL',
    })
    return
  }

  for (const origin of origins) {
    if (!z.url().safeParse(origin).success) {
      context.addIssue({
        code: 'custom',
        message: `Invalid WEB_ORIGIN URL: ${origin}`,
      })
    }
  }
})

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WEB_ORIGIN: webOrigins.default('http://127.0.0.1:5173,http://127.0.0.1:5174'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  COMMAND_PROVIDER: z.enum(['rules', 'llm', 'mock']).default('rules'),
  LLM_BASE_URL: optionalUrl,
  LLM_MODEL: z.string().min(1).optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  IMAGE_PROVIDER: z
    .enum(['stable-diffusion-webui', 'mock'])
    .default('stable-diffusion-webui'),
  SD_WEBUI_BASE_URL: z.url().default('http://127.0.0.1:7860'),
  ASSET_CACHE_DIR: z.string().min(1).default('.cache/assets'),
  STATIC_DIR: z.string().default(''),
  ASR_PROVIDER: z.enum(['local', 'mock']).default('mock'),
  ASR_BASE_URL: optionalUrl,
})

export type AppConfig = z.infer<typeof envSchema>

export function getConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(source)
}
