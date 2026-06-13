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

  it('persists creative memory and recent intent', () => {
    const store = createProjectStore(
      createProject('测试', { id: () => 'project', now: () => first }),
      { now: () => second },
    )

    store.getState().rememberIntent({
      text: '在树下加一只看月亮的小猫',
      creativeDirection: 'quiet warm storybook night',
      sceneSummary: '一棵树和树下的小猫共同望向月亮',
      style: 'soft hand-painted storybook illustration',
    })

    expect(store.getState().project).toMatchObject({
      globalStyle: 'soft hand-painted storybook illustration',
      memory: {
        creativeDirection: 'quiet warm storybook night',
        sceneSummary: '一棵树和树下的小猫共同望向月亮',
        recentIntents: ['在树下加一只看月亮的小猫'],
      },
    })
  })

  it('refreshes local scene memory after adding and modifying layers', () => {
    const store = createProjectStore(
      createProject('测试', { id: () => 'project', now: () => first }),
      { id: () => 'tree', now: () => second },
    )

    store.getState().addReadyLayer({
      name: '树',
      type: 'preset',
      source: 'preset',
      width: 220,
      height: 320,
      x: 120,
      y: 240,
      createdBy: 'voice',
    })

    expect(store.getState().project.memory.sceneSummary).toContain(
      '树位于中部左侧',
    )

    store.getState().execute({
      schemaVersion: 1,
      id: 'move-tree',
      action: 'modify',
      target: { name: '树' },
      properties: { position: 'right' },
      requiresGeneration: false,
      confidence: 1,
    })

    expect(store.getState().project.memory.sceneSummary).toContain(
      '树位于中部右侧',
    )
  })

  it('undoes and redoes project mutations while clearing redo after a new edit', () => {
    const ids = ['sun', 'tree'][Symbol.iterator]()
    const store = createProjectStore(
      createProject('测试', { id: () => 'project', now: () => first }),
      { id: () => ids.next().value!, now: () => second },
    )

    store.getState().addReadyLayer({
      name: '太阳',
      type: 'preset',
      source: 'preset',
      width: 180,
      height: 180,
      createdBy: 'voice',
    })
    store.getState().execute({
      schemaVersion: 1,
      id: 'move-sun',
      action: 'modify',
      target: { id: 'sun' },
      properties: { position: 'top-right' },
      requiresGeneration: false,
      confidence: 1,
    })
    const movedX = store.getState().project.layers[0]!.x

    expect(
      store.getState().execute({
        schemaVersion: 1,
        id: 'undo',
        action: 'undo',
        requiresGeneration: false,
        confidence: 1,
      }).ok,
    ).toBe(true)
    expect(store.getState().project.layers[0]!.x).not.toBe(movedX)

    expect(
      store.getState().execute({
        schemaVersion: 1,
        id: 'redo',
        action: 'redo',
        requiresGeneration: false,
        confidence: 1,
      }).ok,
    ).toBe(true)
    expect(store.getState().project.layers[0]!.x).toBe(movedX)

    store.getState().execute({
      schemaVersion: 1,
      id: 'undo-again',
      action: 'undo',
      requiresGeneration: false,
      confidence: 1,
    })
    store.getState().addReadyLayer({
      name: '树',
      type: 'preset',
      source: 'preset',
      width: 220,
      height: 320,
      createdBy: 'voice',
    })
    expect(store.getState().redoStack).toHaveLength(0)
  })
})
