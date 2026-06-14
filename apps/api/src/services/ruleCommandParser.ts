import { randomUUID } from 'node:crypto'
import {
  drawingCommandSchema,
  type DrawingCommand,
  type ParseCommandRequest,
} from '@xiaohua/contracts'

const presetObjectNames = [
  '太阳',
  '树',
  '草地',
  '云朵',
  '云',
  '月亮',
  '花',
  '房子',
  '小猫',
  '猫咪',
  '猫',
  '小狗',
  '狗狗',
  '狗',
  '小鸟',
  '鸟',
]

function canonicalObjectName(name: string) {
  if (['云', '云朵'].includes(name)) return '云朵'
  if (['猫', '猫咪', '小猫'].includes(name)) return '小猫'
  if (['狗', '狗狗', '小狗'].includes(name)) return '小狗'
  if (['鸟', '小鸟'].includes(name)) return '小鸟'
  return name
}

function objectNameFromText(
  text: string,
  context: ParseCommandRequest['context'],
) {
  const names = [
    ...context.recentLayers.map((layer) => layer.name),
    ...presetObjectNames,
  ]
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort((left, right) => right.length - left.length)
  return names.find((candidate) => text.includes(candidate))
}

function createdObjectNameFromText(text: string) {
  const createVerb = text.search(/画(?!面)|添加|加上|加一个|创建/)
  const matches = presetObjectNames
    .map((name) => ({ name, index: text.indexOf(name) }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index)
  const afterCreate = matches.filter((match) => match.index >= createVerb)
  if (/(?:上|里|中|边|旁)的/.test(text)) {
    return afterCreate.at(-1)?.name ?? matches.at(-1)?.name
  }
  return afterCreate.at(0)?.name ?? matches.at(-1)?.name
}

function createReferenceTargetFromText(
  text: string,
  context: ParseCommandRequest['context'],
  createdName?: string,
): DrawingCommand['target'] {
  const createVerb = text.search(/画(?!面)|添加|加上|加一个|创建/)
  const beforeCreate = createVerb >= 0 ? text.slice(0, createVerb) : text
  const name = context.recentLayers
    .map((layer) => layer.name)
    .filter((candidate) => candidate !== createdName)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => beforeCreate.includes(candidate))
  return name ? { name } : undefined
}

function targetFromText(
  text: string,
  context: ParseCommandRequest['context'],
): DrawingCommand['target'] {
  const name = objectNameFromText(text, context)
  if (text.includes('刚才') || text.includes('上一个')) {
    return { reference: 'recent', ...(name ? { name } : {}) }
  }
  if (text.includes('它') || text.includes('这个') || text.includes('选中')) {
    return { reference: 'selected', ...(name ? { name } : {}) }
  }
  return name ? { name } : undefined
}

function groupTargetFromText(
  text: string,
  context: ParseCommandRequest['context'],
): DrawingCommand['target'] {
  const ids = context.recentLayers
    .filter((layer) => text.includes(layer.name))
    .map((layer) => layer.id)
  return ids.length >= 2 ? { ids } : undefined
}

function positionFromText(text: string): string | undefined {
  const positions: Array<[RegExp, string]> = [
    [/(右上|右上方|右上角)/, 'top-right'],
    [/(左上|左上方|左上角)/, 'top-left'],
    [/(右下|右下方|右下角)/, 'bottom-right'],
    [/(左下|左下方|左下角)/, 'bottom-left'],
    [/(中间|中央|正中|居中)/, 'center'],
    [/(左边|左侧|向左|往左|左移)/, 'left'],
    [/(右边|右侧|向右|往右|右移)/, 'right'],
    [/(旁边|旁|附近|身边|旁边)/, 'right'],
    [/(下面|下方|底下|脚下|树下|下面)/, 'bottom'],
    [/(上面|上方|头顶|顶部)/, 'top'],
    [/(顶部|上面|上方|向上|往上|上移)/, 'top'],
    [/(底部|下面|下方|向下|往下|下移)/, 'bottom'],
  ]
  return positions.find(([pattern]) => pattern.test(text))?.[1]
}

function colorFromText(text: string) {
  const colors: Array<[RegExp, string]> = [
    [/红色|红字/, '#dc2626'],
    [/橙色|橙字/, '#ea580c'],
    [/黄色|黄字/, '#ca8a04'],
    [/绿色|绿字/, '#16a34a'],
    [/蓝色|蓝字/, '#2563eb'],
    [/紫色|紫字/, '#9333ea'],
    [/白色|白字/, '#ffffff'],
    [/黑色|黑字/, '#111827'],
  ]
  return colors.find(([pattern]) => pattern.test(text))?.[1]
}

function looksLikeDrawingDescription(text: string) {
  return /(?:一只|一匹|一棵|一朵|一个|一位|一幅|场景|画面|背景|插画|照片|卡通|写实|水彩|油画|水墨|奔跑|飞翔|站立|坐着|躺着|跳跃|微笑|挥手|草原|森林|海边|天空|人物|动物)/.test(
    text,
  )
}

function looksLikeEditInstruction(text: string) {
  return /(?:把|将|让|调整|安排|移动|挪动|挪到|放到|改成|变成|重新)/.test(text)
}

function looksLikeGeneratedEdit(text: string) {
  return /(?:重新生成|重新画|重画|重绘|换成|换一个|画成|改成|变成|涂成|加上|添上|戴上|戴着|挂上|系上|拿着|抱着|改成.*风格|更.*风格)/.test(
    text,
  )
}

function needsGeneratedNamedObject(text: string) {
  return /(?:背景|场景|草原|草地|草坪|森林|树林|河边|河流|小溪|溪流|湖边|湖泊|海边|海洋|天空|云层|山谷|山脉|街道|房间|室内|庭院|花园|雪地|沙漠|和|与|以及|、|还有|一起|奔跑|飞翔|跳跃|喝水|饮水|挥手|舞蹈|打斗|追逐|游泳|回头|转身|蹲下|躺下|两|二|三|四|五|六|七|八|九|十|[2-9]\d*)/.test(
    text,
  )
}

export function parseRuleCommand(
  request: ParseCommandRequest,
  id: () => string = randomUUID,
): DrawingCommand | null {
  const text = request.text.replaceAll(/\s+/g, '')
  const base = {
    schemaVersion: 1 as const,
    id: id(),
    requiresGeneration: false,
    confidence: 0.98,
  }

  if (/(保存|导出|下载)/.test(text)) {
    return drawingCommandSchema.parse({ ...base, action: 'save' })
  }

  const target = targetFromText(text, request.context)
  if (/^(?:撤销|撤回|回退|上一步|取消上一步)$/.test(text)) {
    return drawingCommandSchema.parse({ ...base, action: 'undo' })
  }
  if (/^(?:重做|恢复|下一步|恢复上一步)$/.test(text)) {
    return drawingCommandSchema.parse({ ...base, action: 'redo' })
  }
  if (/(?:复制|拷贝|克隆|再来一个|再放一个|再加一个|做个副本)/.test(text)) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'duplicate',
      target:
        target ??
        (/再来一个|再放一个|再加一个/.test(text)
          ? { reference: 'recent' }
          : { reference: 'selected' }),
    })
  }
  if (/(?:取消|解除|解散).{0,20}组合/.test(text)) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'ungroup',
      target: target ?? { reference: 'selected' },
    })
  }
  if (/(?:组合|编组|合为一组)/.test(text)) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'group',
      target: groupTargetFromText(text, request.context),
    })
  }
  if (/(删除|删掉|移除)/.test(text)) {
    return drawingCommandSchema.parse({ ...base, action: 'delete', target })
  }
  if (/(选择|选中)/.test(text) && !/(把|将).*(变|移|放|删)/.test(text)) {
    return drawingCommandSchema.parse({ ...base, action: 'select', target })
  }

  const rename = text.match(/(?:重命名为|改名为|叫做)([^，。,.]+)$/)?.[1]
  if (rename) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'rename',
      target,
      properties: { name: rename },
    })
  }

  const zOrder = text.includes('最前')
    ? 'front'
    : text.includes('最后') || text.includes('底层')
      ? 'back'
      : text.includes('上移一层')
        ? 'up'
        : text.includes('下移一层')
          ? 'down'
          : undefined
  if (zOrder) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'reorder',
      target,
      properties: { zOrder },
    })
  }

  const position = positionFromText(text)
  const visible = /(?:显示|取消隐藏|重新显示)/.test(text)
    ? true
    : /(?:隐藏|不可见)/.test(text)
      ? false
      : undefined
  const locked = /(?:解锁|解除锁定)/.test(text)
    ? false
    : /(?:锁定|锁住)/.test(text)
      ? true
      : undefined
  const opacityPercent = text.match(
    /(?:透明度|不透明度)(?:调到|设为|改成|为)?(\d{1,3})%?/,
  )
  const opacity = /(?:完全不透明|不透明)$/.test(text)
    ? 1
    : /(?:完全透明)$/.test(text)
      ? 0
      : /(?:半透明)/.test(text)
        ? 0.5
        : opacityPercent?.[1]
          ? Math.min(1, Number.parseInt(opacityPercent[1], 10) / 100)
          : undefined
  const opacityDelta = /(?:更透明|透明一点)/.test(text)
    ? -0.15
    : /(?:更不透明|不透明一点)/.test(text)
      ? 0.15
      : undefined
  const targetLayer = request.context.recentLayers.find(
    (layer) =>
      layer.id === target?.id ||
      layer.name === target?.name ||
      (target?.reference === 'selected' &&
        layer.id === request.context.selectedLayerId),
  )
  if (targetLayer?.type === 'text') {
    const replacementText =
      request.text.match(/[“"'‘’]([^”"'‘’]+)[”"'‘’]/)?.[1] ??
      request.text.match(
        /(?:文字|标题|内容).*(?:改成|换成|写成)[“"'‘’]?([^”"'‘’，。,.]+)[”"'‘’]?/,
      )?.[1] ??
      request.text.match(/(?:改成|换成|写成)[“"'‘’]([^”"'‘’]+)[”"'‘’]/)?.[1]
    const color = colorFromText(text)
    const fontWeight = /(?:粗体|加粗|醒目|有力)/.test(text) ? 'bold' : undefined
    const fontFamily = /(?:涂鸦|手写|手绘)字/.test(text)
      ? '"STKaiti", "KaiTi", "Microsoft YaHei", sans-serif'
      : /(?:黑体|无衬线)/.test(text)
        ? '"Microsoft YaHei", "SimHei", sans-serif'
        : undefined
    if (
      replacementText ||
      color ||
      fontWeight ||
      fontFamily ||
      position ||
      opacity !== undefined ||
      opacityDelta !== undefined ||
      visible !== undefined ||
      locked !== undefined
    ) {
      return drawingCommandSchema.parse({
        ...base,
        action: 'modify',
        target,
        properties: {
          ...(replacementText ? { text: replacementText.trim() } : {}),
          ...(color ? { color } : {}),
          ...(fontWeight ? { fontWeight } : {}),
          ...(fontFamily ? { fontFamily } : {}),
          ...(position ? { position } : {}),
          ...(opacity !== undefined ? { opacity } : {}),
          ...(opacityDelta !== undefined ? { opacityDelta } : {}),
          ...(visible !== undefined ? { visible } : {}),
          ...(locked !== undefined ? { locked } : {}),
        },
      })
    }
  }
  if (target && looksLikeGeneratedEdit(text)) {
    const color = colorFromText(text)
    return drawingCommandSchema.parse({
      ...base,
      action: 'modify',
      target,
      prompt: request.text,
      ...(color ? { properties: { color } } : {}),
      requiresGeneration: true,
      confidence: 0.94,
    })
  }

  const textMatch =
    request.text.match(
      /(?:写上|写下|添加文字|加上文字|文字是|标题是)[“"'‘’]?([^”"'‘’，。,.]+)[”"'‘’]?/,
    ) ?? request.text.match(/[“"'‘’]([^”"'‘’]+)[”"'‘’].*(?:文字|标题|字)/)
  if (textMatch?.[1]) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'create',
      objectType: 'text',
      properties: {
        text: textMatch[1].trim(),
        name: textMatch[1].trim().slice(0, 20),
        ...(position ? { position } : {}),
        ...(colorFromText(text) ? { color: colorFromText(text) } : {}),
        ...(/(?:涂鸦|手写|手绘)字/.test(text)
          ? {
              fontFamily: '"STKaiti", "KaiTi", "Microsoft YaHei", sans-serif',
            }
          : {}),
        fontWeight: /(?:醒目|粗体|标题|有力)/.test(text) ? 'bold' : 'normal',
      },
      requiresGeneration: false,
      confidence: 0.97,
    })
  }

  if (
    /(?:画(?!面)|添加|加上|加一个|创建)/.test(text) &&
    !(target && looksLikeEditInstruction(text))
  ) {
    const name = createdObjectNameFromText(text)
    const requiresGeneratedNamedObject =
      Boolean(name) && needsGeneratedNamedObject(text)
    const createTarget = createReferenceTargetFromText(
      text,
      request.context,
      name,
    )
    return drawingCommandSchema.parse({
      ...base,
      action: 'create',
      ...(createTarget ? { target: createTarget } : {}),
      objectType: name && !requiresGeneratedNamedObject ? 'preset' : 'image',
      prompt: request.text,
      properties: {
        ...(position ? { position } : {}),
        ...(name ? { name: canonicalObjectName(name) } : {}),
      },
      requiresGeneration: !name || requiresGeneratedNamedObject,
      confidence: name && !requiresGeneratedNamedObject ? 0.99 : 0.88,
    })
  }

  const size = /(变大|放大|大一点)/.test(text)
    ? 'larger'
    : /(变小|缩小|小一点)/.test(text)
      ? 'smaller'
      : undefined
  const rotationText = text.match(/(?:旋转|转)(-?\d+(?:\.\d+)?)度/)
  const rotation = rotationText?.[1]
    ? Number.parseFloat(rotationText[1])
    : undefined
  const rotationDelta = /(?:顺时针|向右)(?:再)?转(?:一点)?/.test(text)
    ? 15
    : /(?:逆时针|向左)(?:再)?转(?:一点)?/.test(text)
      ? -15
      : /(?:再)?转一点/.test(text)
        ? 15
        : undefined
  if (
    position ||
    size ||
    rotation !== undefined ||
    rotationDelta !== undefined ||
    opacity !== undefined ||
    opacityDelta !== undefined ||
    visible !== undefined ||
    locked !== undefined
  ) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'modify',
      target,
      properties: {
        ...(position ? { position } : {}),
        ...(size ? { size } : {}),
        ...(rotation !== undefined ? { rotation } : {}),
        ...(rotationDelta !== undefined ? { rotationDelta } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
        ...(opacityDelta !== undefined ? { opacityDelta } : {}),
        ...(visible !== undefined ? { visible } : {}),
        ...(locked !== undefined ? { locked } : {}),
      },
    })
  }

  if (
    looksLikeDrawingDescription(text) &&
    !(target && looksLikeEditInstruction(text))
  ) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'create',
      objectType: 'image',
      prompt: request.text,
      requiresGeneration: true,
      confidence: 0.82,
    })
  }

  return null
}
