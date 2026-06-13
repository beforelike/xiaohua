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
]

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

function positionFromText(text: string): string | undefined {
  const positions: Array<[RegExp, string]> = [
    [/(右上|右上方|右上角)/, 'top-right'],
    [/(左上|左上方|左上角)/, 'top-left'],
    [/(右下|右下方|右下角)/, 'bottom-right'],
    [/(左下|左下方|左下角)/, 'bottom-left'],
    [/(中间|中央|正中|居中)/, 'center'],
    [/(左边|左侧|向左|往左|左移)/, 'left'],
    [/(右边|右侧|向右|往右|右移)/, 'right'],
    [/(上面|上方|向上|往上|上移)/, 'top'],
    [/(下面|下方|向下|往下|下移)/, 'bottom'],
  ]
  return positions.find(([pattern]) => pattern.test(text))?.[1]
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
  return /(?:重新生成|重新画|重画|重绘|换成|换一个|画成|改成|变成|涂成|加上|添上|改成.*风格|更.*风格)/.test(
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
  if (target && looksLikeGeneratedEdit(text)) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'modify',
      target,
      prompt: request.text,
      requiresGeneration: true,
      confidence: 0.94,
    })
  }

  if (
    /(?:画(?!面)|添加|加上|加一个|创建)/.test(text) &&
    !(target && looksLikeEditInstruction(text))
  ) {
    const name = presetObjectNames.find((candidate) => text.includes(candidate))
    return drawingCommandSchema.parse({
      ...base,
      action: 'create',
      objectType: name ? 'preset' : 'image',
      prompt: request.text,
      properties: {
        ...(position ? { position } : {}),
        ...(name ? { name: name === '云' ? '云朵' : name } : {}),
      },
      requiresGeneration: !name,
      confidence: name ? 0.99 : 0.88,
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
  if (position || size || rotation !== undefined) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'modify',
      target,
      properties: {
        ...(position ? { position } : {}),
        ...(size ? { size } : {}),
        ...(rotation !== undefined ? { rotation } : {}),
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
