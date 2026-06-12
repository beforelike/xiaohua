import { describe, expect, it } from 'vitest'
import type { ParseCommandRequest } from '@xiaohua/contracts'
import { parseRuleCommand } from '../src/services/ruleCommandParser'

const context: ParseCommandRequest['context'] = {
  selectedLayerId: 'tree',
  recentLayers: [{ id: 'sun', name: '太阳', type: 'preset' }],
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
})
