import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

loadDotEnv({ path: path.resolve(process.cwd(), '.env'), quiet: true })

const optionalUrl = z.url().optional()

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  WEB_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  COMMAND_PROVIDER: z.enum(['rules', 'llm', 'mock']).default('rules'),
  LLM_BASE_URL: optionalUrl,
  LLM_MODEL: z.string().min(1).optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  IMAGE_PROVIDER: z
    .enum(['stable-diffusion-webui', 'mock'])
    .default('stable-diffusion-webui'),
  SD_WEBUI_BASE_URL: z.url().default('http://127.0.0.1:7860'),
  ASSET_CACHE_DIR: z.string().min(1).default('.cache/assets'),
  ASR_PROVIDER: z.enum(['local', 'mock']).default('mock'),
  ASR_BASE_URL: optionalUrl,
})

export type AppConfig = z.infer<typeof envSchema>

export function getConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse({
    ...source,
    LLM_BASE_URL: source.LLM_BASE_URL ?? source.base_url,
    LLM_MODEL: source.LLM_MODEL ?? source.modelId,
    LLM_API_KEY: source.LLM_API_KEY ?? source.API,
  })
}
