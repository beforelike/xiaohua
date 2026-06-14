import type {
  GenerationMetadata,
  GenerateAssetRequest,
} from '@xiaohua/contracts'
import type { AppConfig } from '../config'
import { composeNegativePrompt, composePositivePrompt } from './promptComposer'
import { findPreset } from './promptPresets'

export const PROMPT_PIPELINE_VERSION = 13

export function seedFromAssetId(id: string) {
  return Number.parseInt(id.slice(0, 8), 16)
}

export function buildPrompt(
  userPrompt: string,
  background: 'transparent' | 'opaque',
  style?: string,
  isEnhanced = false,
): string {
  const preset = isEnhanced ? null : findPreset(userPrompt)
  return composePositivePrompt({
    prompt: preset?.prompt ?? userPrompt,
    style,
    background,
    enhanced: isEnhanced,
  })
}

export function buildNegativePrompt(
  userPrompt: string,
  customNegative?: string,
  background: 'transparent' | 'opaque' = 'opaque',
): string {
  const preset = findPreset(userPrompt)
  return composeNegativePrompt({
    prompt: userPrompt,
    customNegative,
    presetNegative: preset?.negativeExtra,
    background,
  })
}

export function buildGenerationMetadata(input: {
  request: GenerateAssetRequest
  config: AppConfig
  id: string
  provider?: AppConfig['IMAGE_PROVIDER']
  prompt: string
  negativePrompt: string
}): GenerationMetadata {
  return {
    provider: input.provider ?? input.config.IMAGE_PROVIDER,
    mode: input.request.generationMode ?? 'standard',
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    style: input.request.style ?? input.config.SD_STYLE_PROMPT,
    seed: seedFromAssetId(input.id),
    width: input.request.width,
    height: input.request.height,
    steps: input.config.SD_STEPS,
    cfgScale: input.config.SD_CFG_SCALE,
    sampler: input.config.SD_SAMPLER,
    pipelineVersion: PROMPT_PIPELINE_VERSION,
  }
}

export function buildStableDiffusionTask(input: {
  request: GenerateAssetRequest
  config: AppConfig
  id: string
  prompt: string
  customNegative?: string
  alwaysonScripts?: unknown
}) {
  const isEnhanced = input.request.enhancedPrompt ?? false
  const positivePrompt = buildPrompt(
    input.prompt,
    input.request.background,
    input.request.style ?? input.config.SD_STYLE_PROMPT,
    isEnhanced,
  )
  const negativePrompt = buildNegativePrompt(
    input.request.prompt,
    input.customNegative,
    input.request.background,
  )
  const metadata = buildGenerationMetadata({
    request: input.request,
    config: input.config,
    id: input.id,
    provider: 'stable-diffusion-webui',
    prompt: positivePrompt,
    negativePrompt,
  })

  return {
    prompt: positivePrompt,
    negativePrompt,
    metadata,
    payload: {
      prompt: positivePrompt,
      negative_prompt: negativePrompt,
      width: input.request.width,
      height: input.request.height,
      seed: metadata.seed,
      steps: input.config.SD_STEPS,
      cfg_scale: input.config.SD_CFG_SCALE,
      sampler_name: input.config.SD_SAMPLER,
      batch_size: 1,
      restore_faces: false,
      tiling: false,
      ...(input.alwaysonScripts
        ? { alwayson_scripts: input.alwaysonScripts }
        : {}),
    },
  }
}
