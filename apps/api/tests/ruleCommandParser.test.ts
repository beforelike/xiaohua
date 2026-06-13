import { describe, expect, it } from 'vitest'
import type { ParseCommandRequest } from '@xiaohua/contracts'
import { parseRuleCommand } from '../src/services/ruleCommandParser'

const context: ParseCommandRequest['context'] = {
  selectedLayerId: 'tree',
  recentLayers: [
    { id: 'horse', name: '奔跑的马', type: 'image' },
    { id: 'sun', name: '太阳', type: 'preset' },
  ],
  globalStyle: '童话手绘',
}

function parse(text: string) {
  return parseRuleCommand(
    { schemaVersion: 1, text, context },
    () => 'command-1',
  )
}

describe('parseRuleCommand', () => {
  it.each([
    ['撤销', 'undo'],
    ['重做', 'redo'],
    ['复制这棵树', 'duplicate'],
    ['再来一个', 'duplicate'],
  ] as const)('parses %s as %s', (text, action) => {
    const command = parse(text)

    expect(command?.action).toBe(action)
    expect(command?.requiresGeneration).toBe(false)
  })

  it('parses grouping and ungrouping with explicit layer ids', () => {
    expect(parse('把太阳和奔跑的马组合')).toMatchObject({
      action: 'group',
      target: { ids: ['horse', 'sun'] },
      requiresGeneration: false,
    })
    expect(parse('取消太阳的组合')).toMatchObject({
      action: 'ungroup',
      target: { name: '太阳' },
      requiresGeneration: false,
    })
  })

  it.each([
    ['在右上角画一个太阳', 'create', 'top-right'],
    ['把太阳变小一点并移到右上角', 'modify', 'top-right'],
    ['删除树', 'delete', undefined],
    ['选择树', 'select', undefined],
    ['保存作品', 'save', undefined],
  ])('parses %s', (text, action, position) => {
    const command = parse(text)
    expect(command?.action).toBe(action)
    expect(command?.properties?.position).toBe(position)
  })

  it('uses selected and recent references for pronouns', () => {
    expect(parse('把它变大一点')?.target).toEqual({
      reference: 'selected',
    })
    expect(parse('删除刚才那个')?.target).toEqual({
      reference: 'recent',
    })
  })

  it('returns null for unsupported text', () => {
    expect(parse('今天天气不错')).toBeNull()
  })

  it('treats a direct visual description as a create command', () => {
    expect(parse('一匹白马在草原上奔跑')).toMatchObject({
      action: 'create',
      prompt: '一匹白马在草原上奔跑',
      requiresGeneration: true,
    })
  })

  it('recognizes a common animal as one named object', () => {
    expect(parse('画一只小猫')).toMatchObject({
      action: 'create',
      properties: { name: '小猫' },
    })
  })

  it('creates the object after the drawing verb instead of the reference object', () => {
    const command = parseRuleCommand(
      {
        schemaVersion: 1,
        text: '在树旁边画一只小鸟',
        context: {
          ...context,
          recentLayers: [
            { id: 'tree', name: '树', type: 'preset' },
            ...context.recentLayers,
          ],
        },
      },
      () => 'command-bird',
    )

    expect(command).toMatchObject({
      action: 'create',
      target: { name: '树' },
      objectType: 'preset',
      properties: { name: '小鸟', position: 'right' },
      requiresGeneration: false,
    })
  })

  it('keeps below relations for new objects anchored to existing layers', () => {
    const command = parseRuleCommand(
      {
        schemaVersion: 1,
        text: '在树下画一朵花',
        context: {
          ...context,
          recentLayers: [
            { id: 'tree', name: '树', type: 'preset' },
            ...context.recentLayers,
          ],
        },
      },
      () => 'command-flower',
    )

    expect(command).toMatchObject({
      action: 'create',
      target: { name: '树' },
      properties: { name: '花', position: 'bottom' },
    })
  })

  it('creates editable text without image generation', () => {
    expect(parse('在顶部写上“今天也要开心”，用醒目的粗体')).toMatchObject({
      action: 'create',
      objectType: 'text',
      properties: {
        text: '今天也要开心',
        position: 'top',
        fontWeight: 'bold',
      },
      requiresGeneration: false,
    })
  })

  it('edits existing text content and color without image generation', () => {
    const textContext: ParseCommandRequest['context'] = {
      ...context,
      selectedLayerId: 'title',
      recentLayers: [
        {
          id: 'title',
          name: '标题',
          type: 'text',
          textContent: '今天也要开心',
        },
      ],
    }
    const command = parseRuleCommand(
      {
        schemaVersion: 1,
        text: '把标题文字改成“保持好奇”，换成蓝色',
        context: textContext,
      },
      () => 'command-text',
    )

    expect(command).toMatchObject({
      action: 'modify',
      target: { name: '标题' },
      properties: { text: '保持好奇', color: '#2563eb' },
      requiresGeneration: false,
    })
  })

  it('marks object restyling as generation without changing its target', () => {
    expect(parse('把树换成更梦幻的风格')).toMatchObject({
      action: 'modify',
      target: { name: '树' },
      requiresGeneration: true,
    })
  })

  it('recognizes adding an accessory to an existing object', () => {
    expect(parse('给奔跑的马戴上一顶蓝色帽子')).toMatchObject({
      action: 'modify',
      target: { name: '奔跑的马' },
      prompt: '给奔跑的马戴上一顶蓝色帽子',
      requiresGeneration: true,
    })
  })

  it.each(['把奔跑的马画成一匹黑马', '给奔跑的马加上金色马鞍'])(
    'treats generated edits as modifications: %s',
    (text) => {
      expect(parse(text)).toMatchObject({
        action: 'modify',
        requiresGeneration: true,
      })
    },
  )

  it('keeps requested colors on object restyling commands', () => {
    expect(parse('将太阳涂成红色')).toMatchObject({
      action: 'modify',
      target: { name: '太阳' },
      properties: { color: '#dc2626' },
      requiresGeneration: true,
    })
  })

  it.each([
    ['把奔跑的马向左移动', 'left'],
    ['把奔跑的马往右放', 'right'],
    ['把奔跑的马移到右上方', 'top-right'],
  ])(
    'moves a generated object with natural direction wording: %s',
    (text, position) => {
      expect(parse(text)).toMatchObject({
        action: 'modify',
        target: { name: '奔跑的马' },
        properties: { position },
        requiresGeneration: false,
      })
    },
  )

  it('does not emit a no-op modify command for an unknown direction', () => {
    expect(parse('请把奔跑的马放到东北区域')).toBeNull()
    expect(parse('请重新安排一下奔跑的马，放到画面东北区域')).toBeNull()
  })
})
