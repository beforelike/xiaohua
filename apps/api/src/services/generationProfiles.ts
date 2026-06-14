import type { GenerateAssetRequest } from '@xiaohua/contracts'

export type GenerationMode = NonNullable<GenerateAssetRequest['generationMode']>

const QUALITY_TAGS = [
  'masterpiece',
  'best quality',
  'highly detailed',
  'sharp focus',
  'professional',
]

const COMMON_NEGATIVE_TAGS = [
  'worst quality',
  'low quality',
  'lowres',
  'blurry',
  'out of focus',
  'jpeg artifacts',
  'oversaturated',
  'undersaturated',
  'overexposed',
  'underexposed',
  'text',
  'letters',
  'logo',
  'signature',
  'watermark',
  'username',
  'duplicate',
  'glitch',
]

const FOREGROUND_POSITIVE_TAGS = [
  'isolated object',
  'centered composition',
  'entire object fully visible',
  'full body in frame',
  'wide shot',
  'generous empty margin on all sides',
  'nothing cut off',
  'solid white background',
  'uniform white background',
  'flat even lighting',
  'minimal cast shadow',
  'no scenery',
  'no background clutter',
  'no environmental elements',
]

const FOREGROUND_NEGATIVE_TAGS = [
  'complex background',
  'busy background',
  'cropped subject',
  'partial body',
  'close-up',
  'extreme close-up',
  'truncated',
  'out of frame',
  'cut off',
  'deformed',
  'malformed',
  'extra limbs',
  'missing limbs',
  'bad proportions',
  'river',
  'water',
  'stream',
  'lake',
  'pond',
  'shoreline',
  'riverbank',
  'reflection',
  'forest',
  'trees',
  'landscape',
  'scenery',
  'ground plane',
  'environment',
  'gradient background',
  'dark background',
  'colored background',
  'cast shadow',
]

const SCENE_POSITIVE_TAGS = [
  'one complete cohesive scene',
  'single camera perspective',
  'unified lighting',
  'consistent scale between all subjects',
  'natural contact shadows',
  'clear spatial relationship',
  'subjects interact naturally',
  'edge-to-edge finished composition',
]

const SCENE_NEGATIVE_TAGS = [
  'isolated asset',
  'empty background plate',
  'cutout sticker',
  'separate objects floating',
  'collage',
  'split panels',
  'contact sheet',
  'inconsistent perspective',
  'inconsistent scale',
]

const CHARACTER_SHEET_POSITIVE_TAGS = [
  'production character reference sheet',
  'consistent identity across every view',
  'front view',
  'side view',
  'rear view',
  'complete body visible',
  'plain studio background',
  'neutral pose',
]

const CHARACTER_SHEET_NEGATIVE_TAGS = [
  'action scene',
  'dynamic pose',
  'different character in each view',
  'inconsistent markings',
  'cropped turnaround',
  'environmental background',
]

const CHARACTER_ACTION_POSITIVE_TAGS = [
  'preserve the same character identity',
  'clear requested action',
  'dynamic pose controlled by the prompt',
  'recognizable design features',
  'complete body visible',
]

const CHARACTER_ACTION_NEGATIVE_TAGS = [
  'identity drift',
  'different character',
  'wrong species',
  'neutral pose',
  'static reference sheet',
  'turnaround sheet',
  'contact sheet',
]

export function generationProfileFor(input: {
  mode?: GenerationMode | undefined
  background: 'transparent' | 'opaque'
  multiSubject: boolean
}) {
  const mode = input.mode ?? 'standard'
  const qualityTags = QUALITY_TAGS
  const subjectCardinality = input.multiSubject
    ? 'isolated subject group'
    : 'single subject'
  const foregroundPositive =
    input.background === 'transparent'
      ? [...FOREGROUND_POSITIVE_TAGS, subjectCardinality]
      : []
  const foregroundNegative =
    input.background === 'transparent'
      ? [
          ...FOREGROUND_NEGATIVE_TAGS,
          ...(input.multiSubject ? [] : ['multiple subjects']),
        ]
      : []

  if (mode === 'scene') {
    return {
      qualityTags,
      commonNegativeTags: COMMON_NEGATIVE_TAGS,
      positiveTags: SCENE_POSITIVE_TAGS,
      negativeTags: SCENE_NEGATIVE_TAGS,
    }
  }

  if (mode === 'character-sheet') {
    return {
      qualityTags,
      commonNegativeTags: COMMON_NEGATIVE_TAGS,
      positiveTags: [...CHARACTER_SHEET_POSITIVE_TAGS, ...foregroundPositive],
      negativeTags: [...CHARACTER_SHEET_NEGATIVE_TAGS, ...foregroundNegative],
    }
  }

  if (mode === 'character-action') {
    return {
      qualityTags,
      commonNegativeTags: COMMON_NEGATIVE_TAGS,
      positiveTags: [...CHARACTER_ACTION_POSITIVE_TAGS, ...foregroundPositive],
      negativeTags: [...CHARACTER_ACTION_NEGATIVE_TAGS, ...foregroundNegative],
    }
  }

  return {
    qualityTags,
    commonNegativeTags: COMMON_NEGATIVE_TAGS,
    positiveTags: foregroundPositive,
    negativeTags: foregroundNegative,
  }
}
