import {
  drawingCommandSchema,
  type DrawingCommand,
  type ParseCommandRequest,
} from '@xiaohua/contracts'
import type { AppConfig } from '../config'

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

/**
 * LLM 命令解析系统提示词
 *
 * 核心变更：
 * 1. 当 action 为 create 时，需要将场景拆分为多个独立对象
 * 2. 为每个对象生成增强的英文 SD 提示词
 * 3. 区分背景层（opaque）和前景对象（transparent）
 */
const SYSTEM_PROMPT = `你是一个专业的绘图指令解析器和 Stable Diffusion 提示词工程师。

你的任务是将用户的中文绘图指令转换为 DrawingCommand JSON。

★★★ 核心规则 ★★★

1. 当 action 为 "create" 时，必须进行对象分离：
   - 分析用户描述中的所有对象（如"马在草原上奔跑"→ "草原" + "马"）
   - 背景/场景元素（草原、天空、海洋等）： background="opaque", isBackground=true
   - 前景主体对象（马、人物、建筑等）： background="transparent", isBackground=false
   - 背景层排在 objects 数组前面
   - 为每个对象设置 position（九宫格位置）和 size（small/medium/large/full）
   - 背景层固定 position="center", size="full"

2. 为每个对象生成高质量英文 SD 提示词：
   - 根据用户题材自动判断统一英文 style；用户明确指定风格时优先遵从
   - 未指定风格时，自然动物和真实场景默认使用 photorealistic photography
   - 当前项目已有画风时默认延续，除非用户明确要求更换
   - style 单独保存统一画风；对象 prompt 只描述内容、构图、外观、颜色、材质和局部光照
   - 用户原文中的动作、姿态、朝向、数量和对象关系必须逐项保留，不得改成静态姿势或其他动作
   - 不要在对象 prompt 中重复 style、masterpiece、best quality 等全局词，生图阶段会统一组合
   - 前景对象必须完整入镜并四周留白，包含："entire object fully visible, full body in frame, generous empty margin, isolated object, solid white background, no background clutter, single subject"
   - 负向提示词：根据对象类型生成合适的负向词

3. 对于非 create 命令（select/modify/delete/reorder/rename/save等），正常解析即可，不需要 objects 字段。
   - 用户明确修改、重画、替换或补充已有对象时，必须使用 action="modify"，target 指向 context.recentLayers 中原图层的 id 或 name
   - "把树画成秋天的树"、"给树加上红叶"、"把它换成卡通风格"都是 modify，不得创建同名新对象或新图层
   - 只有用户明确要求增加独立的新画面元素时才使用 create

4. JSON 格式规则：
   - schemaVersion 必须为 1
   - action 只能是: create/select/modify/delete/reorder/rename/save/confirm/cancel
   - confidence 为 0 到 1
   - 当 action="create" 且有多个对象时，必须填写 objects 数组
   - requiresGeneration: 创建时为 true

输出示例（用户输入"画马在草原上奔跑"）：
{
  "schemaVersion": 1,
  "id": "cmd-xxx",
  "action": "create",
  "prompt": "画马在草原上奔跑",
  "style": "photorealistic wildlife photography, natural colors, cinematic daylight, realistic materials, sharp detail",
  "objects": [
    {
      "name": "草原",
      "prompt": "vast green grassland, flat terrain, lush grass, blue sky, soft sunlight, panoramic composition, detailed natural textures",
      "negativePrompt": "buildings, people, animals, text, watermark, low quality, blurry",
      "background": "opaque",
      "isBackground": true,
      "position": "center",
      "size": "full"
    },
    {
      "name": "马",
      "prompt": "a majestic horse galloping, light golden fur, muscular body, flowing mane and tail, dynamic running pose, powerful legs in motion, isolated object, solid white background, no background clutter, single subject",
      "negativePrompt": "complex background, multiple subjects, busy background, lowres, bad anatomy, deformed, blurry, watermark, text",
      "background": "transparent",
      "isBackground": false,
      "position": "center",
      "size": "medium"
    }
  ],
  "objectType": "image",
  "requiresGeneration": true,
  "confidence": 0.95
}

只输出 JSON，不要输出任何其他内容。`

export async function parseLlmCommand(
  request: ParseCommandRequest,
  config: AppConfig,
  fetcher: typeof fetch = fetch,
): Promise<DrawingCommand> {
  if (!config.LLM_BASE_URL || !config.LLM_MODEL || !config.LLM_API_KEY) {
    throw new Error('LLM_NOT_CONFIGURED')
  }

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
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify(request),
          },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    },
  )
  if (!response.ok) throw new Error(`LLM_HTTP_${String(response.status)}`)
  const payload = (await response.json()) as ChatCompletion
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM_EMPTY_RESPONSE')

  return drawingCommandSchema.parse(JSON.parse(content))
}
