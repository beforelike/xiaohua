/**
 * 预设提示词系统
 *
 * 将用户的简单中文关键词映射为高质量的 SD 英文提示词，
 * 使生成结果更贴近用户预期。
 */

export interface PromptPreset {
  /** 用户可能输入的中文关键词（支持多个别名） */
  keywords: string[]
  /** 发送给 SD 的详细英文正向提示词 */
  prompt: string
  /** 可选的专属负向提示词补充（会追加到通用负向提示词后面） */
  negativeExtra?: string
}

export const promptPresets: PromptPreset[] = [
  {
    keywords: ['太阳', '阳光', '日'],
    prompt:
      'a bright cheerful cartoon sun with warm golden rays, cute face, vibrant orange and yellow colors, children illustration style, simple and clean design',
    negativeExtra: 'realistic, photographic',
  },
  {
    keywords: ['树', '大树', '树木'],
    prompt:
      'a beautiful green tree with lush foliage and brown trunk, natural style, soft shading, single tree on clean background, detailed leaves and branches, illustration',
    negativeExtra: 'dead tree, autumn, withered',
  },
  {
    keywords: ['草地', '草坪', '绿地', '草'],
    prompt:
      'a lush green grass field, fresh spring meadow, natural green tones, soft texture, top-down perspective, illustration style, vibrant colors',
  },
  {
    keywords: ['云', '云朵', '白云'],
    prompt:
      'a fluffy white cloud, soft and round shape, cotton-like texture, light and airy, children book illustration style, gentle blue sky background',
  },
  {
    keywords: ['花', '花朵', '鲜花'],
    prompt:
      'a beautiful colorful flower in full bloom, delicate petals, vibrant colors, single flower, botanical illustration style, clean background, detailed',
    negativeExtra: 'wilted, dead',
  },
  {
    keywords: ['房子', '房屋', '小屋', '别墅'],
    prompt:
      'a cute cozy house with red roof and warm lighting, cartoon style, simple architecture, chimney with smoke, garden path, children illustration',
  },
  {
    keywords: ['山', '山峰', '高山', '群山'],
    prompt:
      'a majestic mountain with snow-capped peak, natural landscape, soft purple and blue tones, scenic view, painterly illustration style',
  },
  {
    keywords: ['河', '河流', '小溪', '溪流', '水'],
    prompt:
      'a clear flowing river with gentle waves, blue water, natural riverbank, peaceful scenery, watercolor illustration style, serene atmosphere',
  },
  {
    keywords: ['月亮', '月', '弯月', '满月'],
    prompt:
      'a glowing crescent moon in dark blue night sky, soft silver light, magical atmosphere, dreamy illustration style, stars nearby',
    negativeExtra: 'sun, daylight',
  },
  {
    keywords: ['星星', '星', '星空'],
    prompt:
      'bright twinkling stars in deep blue night sky, various sizes, sparkling light points, magical constellation, dreamy illustration',
    negativeExtra: 'sun, daylight',
  },
  {
    keywords: ['鸟', '小鸟', '鸟儿'],
    prompt:
      'a cute little bird with colorful feathers, perched pose, round body, bright eyes, children illustration style, soft shading, single bird',
  },
  {
    keywords: ['猫', '小猫', '猫咪'],
    prompt:
      'an adorable cartoon cat with big round eyes, fluffy fur, cute pose, warm colors, kawaii style, simple and clean illustration',
  },
  {
    keywords: ['狗', '小狗', '狗狗', '犬'],
    prompt:
      'a cute cartoon dog with happy expression, wagging tail, friendly appearance, warm brown colors, children illustration style',
  },
  {
    keywords: ['蝴蝶', '蝶'],
    prompt:
      'a beautiful butterfly with colorful patterned wings, symmetrical design, vibrant colors, delicate details, illustration style, flying pose',
  },
  {
    keywords: ['彩虹'],
    prompt:
      'a vibrant rainbow arc with all seven colors, bright and clear, cheerful atmosphere, cartoon style, clean background',
  },
  {
    keywords: ['汽车', '车', '小车'],
    prompt:
      'a cute cartoon car, compact design, bright color, rounded shape, simple style, children illustration, clean background',
  },
  {
    keywords: ['飞机', '飞行器'],
    prompt:
      'a small cartoon airplane flying in blue sky, white body with colorful details, simple design, children illustration style, trail clouds',
  },
  {
    keywords: ['船', '小船', '轮船'],
    prompt:
      'a simple cartoon boat on calm water, wooden sailboat, white sail, gentle waves, illustration style, peaceful nautical scene',
  },
  {
    keywords: ['人', '小人', '人物', '男孩', '女孩', '孩子'],
    prompt:
      'a cute chibi character, simple cartoon style, big head small body proportion, friendly expression, colorful clothing, children illustration',
    negativeExtra: 'realistic, photographic, adult content',
  },
  {
    keywords: ['苹果'],
    prompt:
      'a shiny red apple with green leaf, fresh and juicy appearance, simple still life, clean background, illustration style, vibrant red color',
  },
  {
    keywords: ['蛋糕', '生日蛋糕'],
    prompt:
      'a delicious birthday cake with colorful frosting and candles, layered design, sprinkles, celebration theme, cartoon illustration style',
  },
  {
    keywords: ['雪人', '雪'],
    prompt:
      'a cheerful snowman with carrot nose, black button eyes, red scarf, top hat, snowy winter background, children illustration style',
  },
  {
    keywords: ['恐龙'],
    prompt:
      'a friendly cartoon dinosaur, green body, cute expression, short arms, long tail, children illustration style, playful pose',
    negativeExtra: 'scary, horror, realistic',
  },
  {
    keywords: ['火箭', '宇宙飞船'],
    prompt:
      'a colorful cartoon rocket ship launching into space, flames from engine, red and white body, stars around, children illustration style',
  },
  {
    keywords: ['城堡'],
    prompt:
      'a fairy tale castle with tall towers and flags, stone walls, blue sky background, magical atmosphere, fantasy illustration style',
  },
]

/**
 * 根据用户输入的简单提示词查找匹配的预设。
 * 使用包含匹配策略：用户输入包含预设关键词，或预设关键词包含用户输入。
 * 优先精确匹配，再模糊匹配。
 */
export function findPreset(userPrompt: string): PromptPreset | null {
  const normalized = userPrompt.trim().toLowerCase()
  if (!normalized) return null

  // 优先精确匹配：用户输入完全等于某个关键词
  for (const preset of promptPresets) {
    for (const keyword of preset.keywords) {
      if (normalized === keyword) return preset
    }
  }

  // 次优先：用户输入包含某个关键词（如"一个可爱的太阳"包含"太阳"）
  // 选择匹配到的最长关键词以提高精确度
  let bestMatch: PromptPreset | null = null
  let bestLength = 0
  for (const preset of promptPresets) {
    for (const keyword of preset.keywords) {
      if (normalized.includes(keyword) && keyword.length > bestLength) {
        bestMatch = preset
        bestLength = keyword.length
      }
    }
  }

  return bestMatch
}
