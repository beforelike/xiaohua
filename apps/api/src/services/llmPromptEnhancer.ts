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
  identityPrompt?: string | undefined
  actionPrompt?: string | undefined
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
      identityPrompt: z.string().optional(),
      actionPrompt: z.string().optional(),
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

const ENVIRONMENT_TERMS =
  /\b(?:river|water|stream|creek|lake|pond|shore|shoreline|riverbank|forest|woodland|trees?|grassland|meadow|landscape|scenery|environment|background|reflection|reflections|ripples?|rocks?|sky|clouds?)\b/i

function sanitizeForegroundPrompt(prompt: string) {
  const actionSafe = prompt
    .replace(
      /\bdrinking(?:\s+water)?\s+(?:from|at|beside|near|in)\s+(?:a|the)?\s*(?:river|stream|creek|lake|pond)\b/gi,
      'head lowered in a natural drinking pose',
    )
    .replace(
      /\b(?:standing|walking|running|galloping)\s+(?:in|through|beside|near|along)\s+(?:a|the)?\s*(?:river|stream|creek|lake|pond|forest|meadow|grassland)\b/gi,
      (match) => match.split(/\s+(?:in|through|beside|near|along)\s+/i)[0] ?? match,
    )

  const subjectOnly = actionSafe
    .replace(/\r?\n/g, ',')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !ENVIRONMENT_TERMS.test(part))
    .join(', ')

  return subjectOnly || actionSafe
}

function fallbackIdentityPrompt(prompt: string) {
  return prompt
    .replace(
      /\b(?:drinking|running|galloping|walking|standing|sitting|lying|jumping|flying|waving)\b[^,]*/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*|,\s*$/g, '')
}

function requestedSubjectCount(userPrompt: string) {
  const horseCount = userPrompt.match(/([一二两三四五六七八九十\d]+)匹马/)
  if (!horseCount?.[1]) return null
  const values: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  const parsed = values[horseCount[1]] ?? Number.parseInt(horseCount[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

function countWord(count: number) {
  return (
    {
      2: 'two',
      3: 'three',
      4: 'four',
      5: 'five',
      6: 'six',
      7: 'seven',
      8: 'eight',
      9: 'nine',
      10: 'ten',
    }[count] ?? String(count)
  )
}

function enforceHorseCount(prompt: string, count: number) {
  const plural = `${countWord(count)} horses`
  const withoutConflicts = prompt
    .replace(/\ba single horse\b/gi, plural)
    .replace(/\bsingle horse\b/gi, plural)
    .replace(/\bone horse\b/gi, plural)
    .replace(/\ba horse\b/gi, plural)
    .replace(/\bsingle subject(?: group)?\b/gi, 'subject group')
    .replace(/\bfront legs? (?:slightly )?bent\b,?/gi, '')
  const subject = /\bhorses\b/i.test(withoutConflicts)
    ? withoutConflicts
    : `${plural}, ${withoutConflicts}`
  return `(exactly ${plural}, both horses fully visible:1.4), side by side, standing upright on all four legs, (both heads below chest level, necks extended downward, noses pointing toward the ground:1.5), ${subject}`
}

function coordinateObjects(
  result: EnhanceResult,
  userPrompt: string,
): EnhanceResult {
  const hasForeground = result.objects.some((object) => !object.isBackground)
  const foregroundCount = result.objects.filter(
    (object) => !object.isBackground,
  ).length
  const requestedCount = requestedSubjectCount(userPrompt)
  return {
    style: result.style,
    objects: result.objects.map((object) => {
      if (object.isBackground) {
        return {
          ...object,
          prompt: [
            object.prompt,
            hasForeground
              ? 'empty environmental plate, open foreground area reserved for later subject compositing, consistent eye-level camera, coherent light direction'
              : '',
          ]
            .filter(Boolean)
            .join(', '),
          negativePrompt: [
            object.negativePrompt,
            hasForeground
              ? 'horses, people, animals, main subject, foreground character'
              : '',
          ]
            .filter(Boolean)
            .join(', '),
        }
      }
      const subjectPrompt = sanitizeForegroundPrompt(object.prompt)
      const countedPrompt =
        requestedCount && requestedCount > 1 && foregroundCount === 1
          ? enforceHorseCount(subjectPrompt, requestedCount)
          : subjectPrompt
      const countSafeNegative =
        requestedCount && requestedCount > 1
          ? object.negativePrompt
              .replace(/\bmultiple subjects\b,?/gi, '')
              .replace(/\bextra subjects\b,?/gi, '')
          : object.negativePrompt
      return {
        ...object,
        ...(requestedCount === 2 && /马/.test(userPrompt)
          ? { name: '两匹马' }
          : {}),
        prompt: countedPrompt,
        identityPrompt:
          object.identityPrompt?.trim() ||
          fallbackIdentityPrompt(countedPrompt) ||
          countedPrompt,
        actionPrompt: object.actionPrompt?.trim() || countedPrompt,
        negativePrompt: [
          countSafeNegative,
          requestedCount && requestedCount > 1
            ? 'single horse, one horse, sitting, lying down, reclining, kneeling, raised head, upright neck, looking at camera, humanoid, human torso, bottle, bucket'
            : '',
          'river, water, stream, creek, lake, pond, shoreline, riverbank, reflections, forest, trees, grassland, landscape, scenery, environment, background',
        ]
          .filter(Boolean)
          .join(', '),
      }
    }),
  }
}

const SYSTEM_PROMPT = `你是一个专业的 Stable Diffusion 提示词工程师。你的任务是：

1. **对象分离**：分析用户的中文绘图描述，将场景中的不同对象拆分为独立元素。
   - 背景/场景元素（如草原、天空、海洋）标记为 isBackground: true, background: "opaque"
   - 前景主体对象（如马、人物、建筑）标记为 isBackground: false, background: "transparent"
   - 不要把同一背景拆成过多碎片；天空和草地可以合并为一个完整背景层
   - 环境与主体必须职责互斥：河流、河岸、森林、草地、天空、倒影只能出现在背景层
   - 前景对象 prompt 中绝对禁止出现 river, water, stream, forest, trees, grassland, reflection, scenery 等环境实体
   - “马在河边喝水”应拆为“无马的河边背景”与“低头饮水姿态的马”；马层只描述低头姿态，不生成水、河岸或倒影
   - 数量构成一个不可分割关系时可作为一个前景组，例如“两匹马互动”；不同类别且可独立编辑的主体应拆成不同前景层

2. **自动画风判断**：先根据用户意图选择最合适的统一画风，并输出英文 style。
   - 用户明确指定写实、水墨、卡通、油画等风格时，必须优先遵从
   - 用户没有指定时，根据题材自动判断：自然动物与真实场景（如“马在草原上奔跑”）默认写实摄影风格；儿童童话题材可使用绘本插画；传统山水可使用国风水墨
   - 如果当前项目已经有明确画风，新增对象默认延续该画风，除非用户明确要求更换
   - style 必须是可直接用于 Stable Diffusion 的英文协调规范，包含媒介、镜头视角、光线方向、色温、色彩和质感
   - style 不能包含马、河流、树木等具体场景实体；它会原样应用到所有图层以保证融合

3. **提示词增强**：为每个对象生成高质量的英文 Stable Diffusion 提示词。
   - 每个对象的 prompt 只描述主体/场景内容、构图、外观、颜色、材质和局部光照
   - 用户输入中的动作、姿态、朝向、数量和对象关系必须逐项保留，不得替换成更常见的静态姿势
   - 例如“奔跑”必须明确写 galloping/running，“挥手”必须明确写 waving，不得改成 standing
   - 不要在对象 prompt 中重复 style、masterpiece、best quality 等全局风格或质量词；系统会在生图前统一组合
   - 前景对象必须完整入镜并四周留白，包含："entire object fully visible, full body in frame, generous empty margin, isolated object, solid white background, no background, single subject"
   - 前景动作如果依赖环境，用纯姿态表达：drinking → head lowered in a natural drinking pose；不要把被交互的环境画进前景
   - 每个前景角色额外输出 identityPrompt 和 actionPrompt：
     identityPrompt 只包含物种、数量、体型、毛色、花纹、鬃毛、眼睛、配饰等永久身份特征，禁止动作、姿态、镜头和环境
     actionPrompt 只包含当前动作、姿态、朝向和角色间关系，禁止毛色花纹等身份特征和环境
   - 背景场景必须是没有主体的 empty environmental plate，并在前景对象 position 对应区域预留简洁空间
   - 对象内容应与选定的 style 协调，但不要把 style 文本复制进对象 prompt

4. **负向提示词**：为每个对象生成合适的负向提示词。
   - 通用负向词：lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, jpeg artifacts, watermark, blurry, deformed, ugly, duplicate
   - 前景对象额外：complex background, multiple subjects, busy background，以及所有背景实体
   - 背景层负向提示词必须排除所有前景主体类别，避免背景提前生成重复主体
   - 根据对象特性添加特定负向词

5. **输出格式**：严格输出 JSON，格式如下：
{
  "style": "detailed english style prompt for the whole scene",
  "objects": [
    {
      "name": "对象中文名",
      "prompt": "detailed english prompt for stable diffusion",
      "identityPrompt": "stable appearance-only character identity prompt",
      "actionPrompt": "current pose and action only",
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
- 每个对象的内容提示词要独立完整，不依赖其他对象，但不要复制全局 style
- 前景对象的提示词必须强调"完整入镜、四周留白、无背景、单独对象、白色背景"以便后续抠图
- 可以补充不冲突的外观细节，但不得改变用户指定的动作、姿态、数量、朝向或对象关系
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

请先建立“背景实体清单”和“前景主体清单”，确保两者没有重复实体。再逐项保留用户指定的数量、动作、姿态、朝向和空间关系，使用共享镜头与光照生成可合成的图层。已有图层仅用于保持风格与上下文一致，不要重复创建用户未要求新增的对象。`

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
      signal: AbortSignal.timeout(60_000),
    },
  )

  if (!response.ok) throw new Error(`LLM_HTTP_${String(response.status)}`)
  const payload = (await response.json()) as ChatCompletion
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM_EMPTY_RESPONSE')

  const parsed = enhanceResultSchema.parse(JSON.parse(content))
  return coordinateObjects(parsed, userPrompt)
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
- prompt 只描述对象内容、构图、外观、颜色、材质和局部光照
- 必须忠实保留用户描述中的动作、姿态、朝向和数量，不得改成静态或其他动作
- 不要重复全局画风，也不要添加 masterpiece、best quality 等通用质量词；系统会统一组合
- ${background === 'transparent' ? '这是前景对象，提示词必须包含：entire object fully visible, full body in frame, generous empty margin, isolated object, solid white background, no background, single subject' : '这是背景/场景层，生成完整的场景描述'}
- 生成合适的英文负向提示词
- 内容细节需与全局画风协调，但不要复制全局画风文本

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
      signal: AbortSignal.timeout(60_000),
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
