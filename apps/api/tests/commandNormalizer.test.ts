import { describe, expect, it } from 'vitest'
import type { DrawingCommand, ParseCommandRequest } from '@xiaohua/contracts'
import { normalizeCommandForContext } from '../src/services/commandNormalizer'

const request: ParseCommandRequest = {
  schemaVersion: 1,
  text: '把树画成一棵秋天的树',
  context: {
    selectedLayerId: 'tree',
    recentLayers: [{ id: 'tree', name: '树', type: 'image' }],
    globalStyle: '童话手绘',
  },
}

const mistakenCreate: DrawingCommand = {
  schemaVersion: 1,
  id: 'command-1',
  action: 'create',
  objectType: 'image',
  prompt: request.text,
  objects: [
    {
      name: '秋天的树',
      prompt: 'an autumn tree',
      background: 'transparent',
      isBackground: false,
      position: 'center',
      size: 'medium',
    },
  ],
  requiresGeneration: true,
  confidence: 0.9,
}

describe('normalizeCommandForContext', () => {
  it('converts a mistaken create into an existing layer modification', () => {
    expect(normalizeCommandForContext(request, mistakenCreate)).toEqual({
      schemaVersion: 1,
      id: 'command-1',
      action: 'modify',
      target: { id: 'tree' },
      prompt: request.text,
      requiresGeneration: true,
      confidence: 0.9,
    })
  })

  it('keeps a request for a new nearby object as create', () => {
    const createRequest = {
      ...request,
      text: '在树旁边画一只小鸟',
    }
    expect(
      normalizeCommandForContext(createRequest, mistakenCreate).action,
    ).toBe('create')
  })
})
