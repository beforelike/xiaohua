import { describe, expect, it } from 'vitest'
import {
  drawingCommandSchema,
  parseCommandRequestSchema,
  projectSchema,
} from '../src/index'

const timestamp = '2026-06-12T12:00:00.000Z'

describe('projectSchema', () => {
  it('accepts a valid project', () => {
    const project = projectSchema.parse({
      schemaVersion: 1,
      id: 'project-1',
      title: '童话森林',
      canvas: { width: 1024, height: 768, backgroundColor: '#ffffff' },
      globalStyle: '童话手绘',
      layers: [],
      selectedLayerId: null,
      recentLayerIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    expect(project.title).toBe('童话森林')
  })

  it('rejects duplicate layer IDs and missing selection', () => {
    const layer = {
      id: 'layer-1',
      name: '太阳',
      type: 'preset',
      source: 'preset',
      status: 'ready',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: 0,
      createdBy: 'voice',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const result = projectSchema.safeParse({
      schemaVersion: 1,
      id: 'project-1',
      title: '测试',
      canvas: { width: 1024, height: 768, backgroundColor: '#fff' },
      globalStyle: '',
      layers: [layer, layer],
      selectedLayerId: 'missing',
      recentLayerIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(2)
  })
})

describe('drawingCommandSchema', () => {
  it('rejects confidence outside the allowed range', () => {
    const result = drawingCommandSchema.safeParse({
      schemaVersion: 1,
      id: 'cmd-1',
      action: 'delete',
      requiresGeneration: false,
      confidence: 1.5,
    })

    expect(result.success).toBe(false)
  })
})

describe('parseCommandRequestSchema', () => {
  it('rejects blank transcript text', () => {
    const result = parseCommandRequestSchema.safeParse({
      schemaVersion: 1,
      text: '   ',
      context: {
        selectedLayerId: null,
        recentLayers: [],
        globalStyle: '',
      },
    })

    expect(result.success).toBe(false)
  })
})
