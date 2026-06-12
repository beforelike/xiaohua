/**
 * LLM 提示词增强服务
 *
 * 使用 LLM 将用户的简单中文描述增强为高质量的 SD WebUI 英文提示词，
 * 同时支持对象分离：将复合场景拆分为独立对象，每个对象生成独立的提示词。
 */

import { z } from 'zod'
import type { ParseCommandRequest } from '@xiaohua/contracts'
import type { AppConfig } from '../config'

/** 单个对象的增强提示词结果 */
export interface EnhancedObject {
  /** 对象中文名称 */
  name: string
  /** 增强后的英文正向提示词 */
  prompt: string
  /** 英文负向提示词 */
  negativePrompt: string
  /** 背景类型 */
  background: 'transparent' | 'opaque'
  /** 是否为场景背景层 */
  isBackground: boolean
  /** 建议位置 */
  position:
    | 'top-left'
    | 'top'
    | 'top-right'
    | 'left'
    | 'center'
    | 'right'
    | 'bottom-left'
    | 'bottom'
    | 'bottom-right'
  /** 建议尺寸 */
  size: 'small' | 'medium' | 'large' | 'full'
}

/** 提示词增强结果 */
export interface EnhanceResult {
  /** LLM 为当前场景选择的统一英文画风 */
  style: string
  /** 分离出的对象列表 */
  objects: EnhancedObject[]
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

const enhanceResultSchema = z.object({
  style: z.string().trim().min(1).max(500),
  objects: z.array(
    z.object({
      name: z.string(),
      prompt: z.string(),
      negativePrompt: z.string(),
      background: z.enum(['transparent', 'opaque']),
      isBackground: z.boolean(),
      position: z
        .enum([
          'top-left',
          'top',
          'top-right',
          'left',
          'center',
          'right',
          'bottom-left',
          'bottom',
          'bottom-right',
        ])
        .default('center'),
      size: z.enum(['small', 'medium', 'large', 'full']).default('medium'),
    }),
  ),
})

const SYSTEM_PROMPT = `你是一个专业的 Stable Diffusion 提示词工程师。你的任务是：

1. **对象分离**：分析用户的中文绘图描述，将场景中的不同对象拆分为独立元素。
   - 背景/场景元素（如草原、天空、海洋）标记为 isBackground: true, background: "opaque"
   - 前景主体对象（如马、人物、建筑）标记为 isBackground: false, background: "transparent"
   - 不要把同一背景拆成过多碎片；天空和草地可以合并为一个完整背景层

2. **自动画风判断**：先根据用户意图选择最合适的统一画风，并输出英文 style。
   - 用户明确指定写实、水墨、卡通、油画等风格时，必须优先遵从
   - 用户没有指定时，根据题材自动判断：自然动物与真实场景（如“马在草原上奔跑”）默认写实摄影风格；儿童童话题材可使用绘本插画；传统山水可使用国风水墨
   - 如果当前项目已经有明确画风，新增对象默认延续该画风，除非用户明确要求更换
   - style 必须是可直接用于 Stable Diffusion 的详细英文风格提示词，包含媒介、色彩、光照和质感

3. **提示词增强**：为每个对象生成高质量的英文 Stable Diffusion 提示词。
   - 正向提示词要求：详细描述对象的外观、颜色、质感、风格、光照等
   - 前景对象必须包含："isolated object, solid white background, no background, single subject"
   - 背景场景必须包含全场景描述
   - 所有对象必须使用选定的 style，保持一致的媒介、线条、色彩和光照

4. **负向提示词**：为每个对象生成合适的负向提示词。
   - 通用负向词：lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, jpeg artifacts, watermark, blurry, deformed, ugly, duplicate
   - 前景对象额外：complex background, multiple subjects, busy background
   - 根据对象特性添加特定负向词

5. **输出格式**：严格输出 JSON，格式如下：
{
  "style": "detailed english style prompt for the whole scene",
  "objects": [
    {
      "name": "对象中文名",
      "prompt": "detailed english prompt for stable diffusion",
      "negativePrompt": "english negative prompt",
      "background": "transparent|opaque",
      "isBackground": true|false,
      "position": "top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right",
      "size": "small|medium|large|full"
    }
  ]
}

注意事项：
- 背景层排在数组前面，前景层排在后面
- 背景层使用 position="center", size="full"
- 根据“在左边、远处、右上角”等空间语义设置前景对象 position 和 size
- 每个对象的提示词要独立完整，不依赖其他对象
- 前景对象的提示词必须强调"无背景、单独对象、白色背景"以便后续抠图
- 对用户描述进行创造性补充，添加细节让画面更生动
- 所有提示词必须是英文
- 只输出 JSON，不要输出任何其他内容`

/**
 * 使用 LLM 增强用户的简单提示词
 *
 * @param userPrompt 用户的中文输入，如 "画马在草原上奔跑"
 * @param globalStyle 当前项目已确定的画风；空字符串表示由 LLM 自动判断
 * @param config 应用配置
 * @param fetcher 可注入的 fetch 函数
 * @returns 增强后的对象列表
 */
export async function enhancePrompt(
  userPrompt: string,
  globalStyle: string,
  context: ParseCommandRequest['context'],
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<EnhanceResult> {
  if (!config.LLM_BASE_URL || !config.LLM_MODEL || !config.LLM_API_KEY) {
    throw new Error('LLM_NOT_CONFIGURED')
  }

  const memory = context.recentLayers.map((layer) => ({
    name: layer.name,
    type: layer.type,
    prompt: layer.prompt,
    position:
      layer.x === undefined
        ? undefined
        : {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
          },
  }))
  const userMessage = `用户输入：${userPrompt}
当前项目画风：${globalStyle || '尚未确定，请根据用户题材自动选择'}
当前项目已有图层记忆：${JSON.stringify(memory)}

请先判断当前场景最合适的画风，再结合已有对象生成增强提示词。已有图层仅用于保持风格与上下文一致，不要重复创建用户未要求新增的对象。`

  const response = await fetcher(
    `${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    },
  )

  if (!response.ok) throw new Error(`LLM_HTTP_${String(response.status)}`)
  const payload = (await response.json()) as ChatCompletion
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM_EMPTY_RESPONSE')

  const parsed = enhanceResultSchema.parse(JSON.parse(content))
  return parsed
}

/**
 * 对单个对象的简单提示词进行 LLM 增强（不做对象分离）
 * 用于重新生成场景中已有图层的情况
 */
export async function enhanceSinglePrompt(
  objectName: string,
  userPrompt: string,
  background: 'transparent' | 'opaque',
  globalStyle: string,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ prompt: string; negativePrompt: string }> {
  if (!config.LLM_BASE_URL || !config.LLM_MODEL || !config.LLM_API_KEY) {
    throw new Error('LLM_NOT_CONFIGURED')
  }

  const singlePromptSystemMessage = `你是一个专业的 Stable Diffusion 提示词工程师。
根据用户的描述，为单个对象生成高质量的英文 SD 提示词。

规则：
- 生成详细的英文正向提示词，包含外观、颜色、质感、风格描述
- ${background === 'transparent' ? '这是前景对象，提示词必须包含：isolated object, solid white background, no background, single subject' : '这是背景/场景层，生成完整的场景描述'}
- 生成合适的英文负向提示词
- 根据画风进行适配

输出 JSON 格式：
{ "prompt": "english prompt", "negativePrompt": "english negative prompt" }

只输出 JSON，不要输出其他内容。`

  const userMessage = `对象名称：${objectName}\n用户描述：${userPrompt}\n背景类型：${background}\n全局画风：${globalStyle}`

  const response = await fetcher(
    `${config.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.LLM_MODEL,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: singlePromptSystemMessage },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    },
  )

  if (!response.ok) throw new Error(`LLM_HTTP_${String(response.status)}`)
  const payload = (await response.json()) as ChatCompletion
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM_EMPTY_RESPONSE')

  const result = z
    .object({
      prompt: z.string(),
      negativePrompt: z.string(),
    })
    .parse(JSON.parse(content))

  return result
}
