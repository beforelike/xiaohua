import { describe, expect, it } from 'vitest'
import type { DrawingCommand } from '@xiaohua/contracts'
import { createProject } from '../features/project/model'
import { createProjectStore } from './projectStore'

const first = '2026-06-12T12:00:00.000Z'
const second = '2026-06-12T12:01:00.000Z'

describe('projectStore', () => {
  it('adds a ready layer and selects it atomically', () => {
    const store = createProjectStore(
      createProject('测试', { id: () => 'project', now: () => first }),
      { id: () => 'sun', now: () => second },
    )

    store.getState().addReadyLayer({
      name: '太阳',
      type: 'preset',
      source: 'preset',
      width: 180,
      height: 180,
      createdBy: 'voice',
    })

    const state = store.getState()
    expect(state.project.layers).toHaveLength(1)
    expect(state.project.selectedLayerId).toBe('sun')
    expect(state.project.updatedAt).toBe(second)
  })

  it('does not commit a failed command', () => {
    const store = createProjectStore(
      createProject('测试', { id: () => 'project', now: () => first }),
      { now: () => second },
    )
    const before = store.getState().project
    const command: DrawingCommand = {
      schemaVersion: 1,
      id: 'delete',
      action: 'delete',
      target: { name: '不存在' },
      requiresGeneration: false,
      confidence: 1,
    }

    const result = store.getState().execute(command)

    expect(result.ok).toBe(false)
    expect(store.getState().project).toBe(before)
    expect(store.getState().lastResult).toBe(result)
  })

  it('replaces only the generated asset fields', () => {
    const store = createProjectStore(
      createProject('测试', { id: () => 'project', now: () => first }),
      { id: () => 'tree', now: () => second },
    )
    store.getState().addReadyLayer({
      name: '树',
      type: 'preset',
      source: 'preset',
      assetUrl: 'old.svg',
      width: 220,
      height: 320,
      x: 12,
      y: 24,
      rotation: 8,
      createdBy: 'voice',
    })
    const before = store.getState().project.layers[0]!

    expect(
      store.getState().replaceLayerAsset('tree', {
        assetUrl: '/api/assets/new',
        source: 'generated',
        prompt: '梦幻的树',
      }),
    ).toBe(true)

    expect(store.getState().project.layers[0]).toMatchObject({
      id: before.id,
      x: before.x,
      y: before.y,
      width: before.width,
      height: before.height,
      rotation: before.rotation,
      zIndex: before.zIndex,
      assetUrl: '/api/assets/new',
      source: 'generated',
      prompt: '梦幻的树',
    })
  })
})
