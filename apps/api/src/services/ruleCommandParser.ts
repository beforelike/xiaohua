import { randomUUID } from 'node:crypto'
import {
  drawingCommandSchema,
  type DrawingCommand,
  type ParseCommandRequest,
} from '@xiaohua/contracts'

const objectNames = ['太阳', '树', '草地', '云朵', '云', '月亮', '花', '房子']

function targetFromText(text: string): DrawingCommand['target'] {
  const name = objectNames.find((candidate) => text.includes(candidate))
  if (text.includes('刚才') || text.includes('上一个')) {
    return { reference: 'recent', ...(name ? { name } : {}) }
  }
  if (text.includes('它') || text.includes('这个') || text.includes('选中')) {
    return { reference: 'selected', ...(name ? { name } : {}) }
  }
  return name ? { name } : undefined
}

function positionFromText(text: string): string | undefined {
  const positions: Array<[string, string]> = [
    ['右上', 'top-right'],
    ['左上', 'top-left'],
    ['右下', 'bottom-right'],
    ['左下', 'bottom-left'],
    ['中间', 'center'],
    ['中央', 'center'],
    ['左边', 'left'],
    ['右边', 'right'],
    ['上面', 'top'],
    ['下面', 'bottom'],
  ]
  return positions.find(([keyword]) => text.includes(keyword))?.[1]
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

  const target = targetFromText(text)
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
  if (/(重新生成|重新画|换成|换一个|改成.*风格|更.*风格)/.test(text)) {
    return drawingCommandSchema.parse({
      ...base,
      action: 'modify',
      target,
      prompt: request.text,
      requiresGeneration: true,
      confidence: 0.94,
    })
  }

  if (/(画|添加|加上|加一个|创建)/.test(text)) {
    const name = objectNames.find((candidate) => text.includes(candidate))
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
  if (
    position ||
    size ||
    rotation !== undefined ||
    /(移动|放到|变大|变小|缩小|放大)/.test(text)
  ) {
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

  return null
}
