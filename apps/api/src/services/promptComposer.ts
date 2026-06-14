import type { GenerationMode } from './generationProfiles'
import { generationProfileFor } from './generationProfiles'

const SUBJECT_COUNT_WORDS: Array<[RegExp, number]> = [
  [/\b(?:two|pair of)\b|两|二/, 2],
  [/\bthree\b|三/, 3],
  [/\bfour\b|四/, 4],
  [/\bfive\b|五/, 5],
  [/\bsix\b|六/, 6],
  [/\bseven\b|七/, 7],
  [/\beight\b|八/, 8],
  [/\bnine\b|九/, 9],
  [/\bten\b|十/, 10],
]

export function requestedSubjectCount(prompt: string) {
  const numeric = prompt.match(
    /\b(?:exactly\s+)?([2-9]|10)\s+(?:subjects?|characters?|people|persons?|animals?|horses?|dogs?|cats?|birds?)\b/i,
  )
  if (numeric?.[1]) return Number(numeric[1])
  for (const [pattern, count] of SUBJECT_COUNT_WORDS) {
    if (pattern.test(prompt)) return count
  }
  return 1
}

function isMultiSubjectPrompt(prompt: string) {
  return (
    requestedSubjectCount(prompt) > 1 ||
    /\b(?:group of|multiple)\b/i.test(prompt)
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

export function joinPromptTags(
  ...values: Array<string | string[] | undefined>
) {
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
  mode?: GenerationMode | undefined
}) {
  const corePrompt = input.prompt.trim()
  const styledPrompt = input.style?.includes('{prompt}')
    ? input.style.replaceAll('{prompt}', corePrompt)
    : joinPromptTags(input.style, corePrompt)
  const profile = generationProfileFor({
    mode: input.mode,
    background: input.background,
    multiSubject: isMultiSubjectPrompt(corePrompt),
  })

  return joinPromptTags(
    input.enhanced ? undefined : profile.qualityTags,
    styledPrompt,
    profile.positiveTags,
  )
}

export function composeNegativePrompt(input: {
  prompt?: string | undefined
  customNegative?: string | undefined
  presetNegative?: string | undefined
  background: 'transparent' | 'opaque'
  mode?: GenerationMode | undefined
}) {
  const profile = generationProfileFor({
    mode: input.mode,
    background: input.background,
    multiSubject: isMultiSubjectPrompt(input.prompt ?? ''),
  })

  return joinPromptTags(
    profile.commonNegativeTags,
    profile.negativeTags,
    input.presetNegative,
    input.customNegative,
  )
}
