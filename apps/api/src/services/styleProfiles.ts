import { joinPromptTags } from './promptComposer'

interface StyleProfile {
  id: string
  keywords: string[]
  template: string
}

const STYLE_PROFILES: StyleProfile[] = [
  {
    id: 'photorealistic',
    keywords: [
      'photorealistic',
      'realistic',
      'photography',
      'photo',
      'wildlife',
      'editorial',
      '写实',
      '摄影',
      '真实',
    ],
    template:
      'photorealistic editorial image of {prompt}, natural colors, coherent camera perspective, realistic materials, directional cinematic light, sharp detail',
  },
  {
    id: 'storybook',
    keywords: [
      'storybook',
      'children',
      'children book',
      'hand-painted',
      'illustration',
      '童话',
      '绘本',
      '手绘',
      '插画',
    ],
    template:
      "soft hand-painted storybook illustration of {prompt}, warm gentle color palette, clean readable shapes, cohesive lighting, polished children's book art",
  },
  {
    id: 'watercolor',
    keywords: ['watercolor', '水彩'],
    template:
      'delicate watercolor painting of {prompt}, translucent layered pigments, soft paper texture, gentle edges, harmonious pastel palette',
  },
  {
    id: 'ink',
    keywords: ['ink', 'chinese ink', 'sumi', '水墨', '国风', '中国风'],
    template:
      'elegant Chinese ink painting of {prompt}, expressive brushwork, controlled ink wash, balanced negative space, subtle paper texture',
  },
  {
    id: 'anime',
    keywords: ['anime', 'manga', '二次元', '动漫'],
    template:
      'polished anime illustration of {prompt}, clean lineart, vibrant colors, expressive shapes, cohesive cel shading, high quality detail',
  },
]

export function resolveStylePrompt(style: string | undefined) {
  const trimmed = style?.trim()
  if (!trimmed) return ''
  if (trimmed.includes('{prompt}')) return trimmed

  const normalized = trimmed.toLocaleLowerCase()
  const profile = STYLE_PROFILES.find((candidate) =>
    candidate.keywords.some((keyword) =>
      normalized.includes(keyword.toLocaleLowerCase()),
    ),
  )
  if (!profile) return trimmed

  return joinPromptTags(profile.template, trimmed)
}
