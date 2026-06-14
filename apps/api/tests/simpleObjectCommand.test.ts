import { describe, expect, it } from 'vitest'
import type { DrawingCommand } from '@xiaohua/contracts'
import { simpleObjectForCommand } from '../src/services/simpleObjectCommand'

const command: DrawingCommand = {
  schemaVersion: 1,
  id: 'cat',
  action: 'create',
  objectType: 'image',
  properties: { name: '小猫' },
  prompt: '画一只小猫',
  requiresGeneration: true,
  confidence: 1,
}

describe('simpleObjectForCommand', () => {
  it('builds a deterministic single object for a common voice request', () => {
    const object = simpleObjectForCommand(command, '画一只小猫')
    expect(object).toMatchObject({
      name: '小猫',
      background: 'transparent',
      isBackground: false,
      position: 'center',
      size: 'medium',
    })
    expect(object?.prompt).toContain('(1cat:1.8)')
    expect(object?.negativePrompt).toContain('torus')
  })

  it.each(['画一只草地上的小猫', '画一只小猫和一只小狗', '画两只小猫'])(
    'keeps complex requests on the LLM path: %s',
    (text) => {
      expect(simpleObjectForCommand(command, text)).toBeNull()
    },
  )
})
