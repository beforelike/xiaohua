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

  it('marks object restyling as generation without changing its target', () => {
    expect(parse('把树换成更梦幻的风格')).toMatchObject({
      action: 'modify',
      target: { name: '树' },
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
