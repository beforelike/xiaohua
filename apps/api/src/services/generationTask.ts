import type {
  GenerationMetadata,
  GenerateAssetRequest,
} from '@xiaohua/contracts'
import type { AppConfig } from '../config'
import {
  composeNegativePrompt,
  composePositivePrompt,
  requestedSubjectCount,
} from './promptComposer'
import { findPreset } from './promptPresets'
import { resolveStylePrompt } from './styleProfiles'

export const PROMPT_PIPELINE_VERSION = 15

export function seedFromAssetId(id: string) {
  return Number.parseInt(id.slice(0, 8), 16)
}

export function buildPrompt(
  userPrompt: string,
  background: 'transparent' | 'opaque',
  style?: string,
  isEnhanced = false,
  mode?: GenerateAssetRequest['generationMode'],
): string {
  const preset = isEnhanced ? null : findPreset(userPrompt)
  return composePositivePrompt({
    prompt: preset?.prompt ?? userPrompt,
    style,
    background,
    enhanced: isEnhanced,
    mode,
  })
}

export function buildNegativePrompt(
  userPrompt: string,
  customNegative?: string,
  background: 'transparent' | 'opaque' = 'opaque',
  mode?: GenerateAssetRequest['generationMode'],
): string {
  const preset = findPreset(userPrompt)
  return composeNegativePrompt({
    prompt: userPrompt,
    customNegative,
    presetNegative: preset?.negativeExtra,
    background,
    mode,
  })
}

export function buildGenerationMetadata(input: {
  request: GenerateAssetRequest
  config: AppConfig
  id: string
  provider?: AppConfig['IMAGE_PROVIDER']
  prompt: string
  negativePrompt: string
  style?: string
}): GenerationMetadata {
  return {
    provider: input.provider ?? input.config.IMAGE_PROVIDER,
    mode: input.request.generationMode ?? 'standard',
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    style:
      input.style ??
      resolveStylePrompt(input.request.style ?? input.config.SD_STYLE_PROMPT),
    seed: seedFromAssetId(input.id),
    width: input.request.width,
    height: input.request.height,
    steps: input.config.SD_STEPS,
    cfgScale: input.config.SD_CFG_SCALE,
    sampler: input.config.SD_SAMPLER,
    pipelineVersion: PROMPT_PIPELINE_VERSION,
  }
}

function expectedSubjectCount(request: GenerateAssetRequest) {
  return Math.max(
    requestedSubjectCount(request.prompt),
    requestedSubjectCount(request.identityConstraints ?? ''),
  )
}

export function buildGeminiImageTask(input: {
  request: GenerateAssetRequest
  config: AppConfig
  id: string
  includeVisualReferences?: boolean
}) {
  const includeVisualReferences = input.includeVisualReferences ?? true
  const expectedSubjects = expectedSubjectCount(input.request)
  const subjectDescription =
    expectedSubjects === 1
      ? 'the requested foreground subject'
      : `the requested group of exactly ${String(expectedSubjects)} foreground subjects`
  const generationMode = input.request.generationMode ?? 'standard'
  const foregroundInstructions =
    generationMode === 'scene'
      ? 'Render the complete requested scene edge to edge as one cohesive image. Include every requested subject and make their spatial relationship and interaction unmistakable. Use one camera, one perspective, unified lighting, consistent scale, natural contact shadows, and a single polished visual style. Compose the subjects and environment together instead of making isolated assets or an empty background plate.'
      : input.request.background === 'transparent'
        ? `Render only ${subjectDescription} as a finished full-color production asset with solid clean fills, fully visible and centered on a pure uniform white studio background. Do not add a frame, circle, oval, panel, badge, decoration, ground, scenery, sketch lines, construction lines, motion lines, monochrome ink drafts, or text.`
        : generationMode === 'character-sheet' ||
            generationMode === 'character-action'
          ? 'Render the requested character reference or action image on a plain, unobtrusive studio background. Do not reinterpret it as an environmental background plate.'
          : 'Render only the requested edge-to-edge environmental background plate. Keep intentional open space for the existing foreground layers, and do not reproduce any existing character, object, title, frame, border, text, or watermark.'
  const prompt = [
    'You are the visual director for an editable layered artwork.',
    `Artwork direction: ${resolveStylePrompt(input.request.style ?? input.config.SD_STYLE_PROMPT)}`,
    input.request.sceneContext
      ? `Current artwork memory and composition: ${input.request.sceneContext}`
      : undefined,
    `Requested layer: ${input.request.prompt}`,
    foregroundInstructions,
    input.request.referenceAssetId && includeVisualReferences
      ? 'The first reference image is the existing version of this same layer. Preserve every identity and design feature not explicitly changed by the request.'
      : undefined,
    input.request.referenceAssetId && input.request.preservePose
      ? 'This is a minimal edit, not a redesign. Preserve the exact subject composition, count, pose, silhouette, scale, faces, markings, and camera angle; change only the explicitly requested detail.'
      : undefined,
    input.request.referenceAssetId && input.request.preservePose === false
      ? 'Use the reference image only for immutable identity, anatomy, face, body proportions, markings, materials, and colors. The old pose and old head direction are forbidden. Repose the same subject so the newly requested action is literal, unmistakable, and visibly different; every limb, head angle, gaze, and body orientation must support the new action.'
      : undefined,
    input.request.identityConstraints
      ? `Immutable identity constraints: ${input.request.identityConstraints}. These are hard requirements, not suggestions.`
      : undefined,
    input.request.referenceAssetId
      ? 'Do not redesign, age, recolor, change species, change body type, add, remove, or replace referenced subjects. Keep the same recognizable individual or group.'
      : undefined,
    input.request.sceneImageDataUrl && generationMode !== 'scene'
      ? 'The final reference image is the current full canvas. Match its camera, perspective, palette, lighting, rendering language, and available spatial role. Do not copy other objects into this isolated layer.'
      : undefined,
    input.request.negativePrompt
      ? `Strictly avoid: ${input.request.negativePrompt}.`
      : undefined,
    input.request.background === 'transparent'
      ? `Show exactly ${String(expectedSubjects)} requested ${expectedSubjects === 1 ? 'subject' : 'subjects'} and no extra depictions. No alternate pose, second view, turnaround, character sheet, contact sheet, grid, collage, inset, comparison, or duplicated body.`
      : undefined,
    'Return one polished production-ready image, not a draft, concept sheet, comparison, collage, frame, badge, or annotated design.',
  ]
    .filter(Boolean)
    .join('\n')
  const negativePrompt = input.request.negativePrompt ?? ''

  return {
    prompt,
    negativePrompt,
    metadata: buildGenerationMetadata({
      request: input.request,
      config: input.config,
      id: input.id,
      provider: 'gemini-image',
      prompt,
      negativePrompt,
      style: resolveStylePrompt(
        input.request.style ?? input.config.SD_STYLE_PROMPT,
      ),
    }),
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
  const style = resolveStylePrompt(
    input.request.style ?? input.config.SD_STYLE_PROMPT,
  )
  const positivePrompt = buildPrompt(
    input.prompt,
    input.request.background,
    style,
    isEnhanced,
    input.request.generationMode,
  )
  const negativePrompt = buildNegativePrompt(
    input.request.prompt,
    input.customNegative,
    input.request.background,
    input.request.generationMode,
  )
  const metadata = buildGenerationMetadata({
    request: input.request,
    config: input.config,
    id: input.id,
    provider: 'stable-diffusion-webui',
    prompt: positivePrompt,
    negativePrompt,
    style,
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
