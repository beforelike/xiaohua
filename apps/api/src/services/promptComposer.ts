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

function isMultiSubjectPrompt(prompt: string) {
  return /\b(?:two|three|four|five|six|seven|eight|nine|ten|pair of|group of|multiple)\b/i.test(
    prompt,
  )
}

function splitPrompt(value: string): string[] {
  return value
    .replace(/\r?\n/g, ',')
    .replace(/\s+/g, ' ')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function joinPromptTags(...values: Array<string | string[] | undefined>) {
  const tags = values.flatMap((value) =>
    value === undefined
      ? []
      : Array.isArray(value)
        ? value.flatMap(splitPrompt)
        : splitPrompt(value),
  )
  const seen = new Set<string>()
  return tags
    .filter((tag) => {
      const key = tag.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(', ')
}

export function composePositivePrompt(input: {
  prompt: string
  style?: string | undefined
  background: 'transparent' | 'opaque'
  enhanced: boolean
}) {
  const corePrompt = input.prompt.trim()
  const styledPrompt = input.style?.includes('{prompt}')
    ? input.style.replaceAll('{prompt}', corePrompt)
    : joinPromptTags(input.style, corePrompt)
  const subjectCardinality = isMultiSubjectPrompt(corePrompt)
    ? 'isolated subject group'
    : 'single subject'

  return joinPromptTags(
    input.enhanced ? undefined : QUALITY_TAGS,
    styledPrompt,
    input.background === 'transparent'
      ? [...FOREGROUND_POSITIVE_TAGS, subjectCardinality]
      : undefined,
  )
}

export function composeNegativePrompt(input: {
  prompt?: string | undefined
  customNegative?: string | undefined
  presetNegative?: string | undefined
  background: 'transparent' | 'opaque'
}) {
  return joinPromptTags(
    COMMON_NEGATIVE_TAGS,
    input.background === 'transparent'
      ? [
          ...FOREGROUND_NEGATIVE_TAGS,
          ...(isMultiSubjectPrompt(input.prompt ?? '')
            ? []
            : ['multiple subjects']),
        ]
      : undefined,
    input.presetNegative,
    input.customNegative,
  )
}
