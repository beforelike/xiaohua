import { describe, expect, it } from 'vitest'
import type { DrawingCommand, Project } from '@xiaohua/contracts'
import { executeCommand } from './executeCommand'
import { addLayer, createLayer, createProject } from '../project/model'

const now = '2026-06-12T12:00:00.000Z'
const later = '2026-06-12T12:01:00.000Z'
const factory = { id: () => 'project-1', now: () => now }

function command(
  input: Omit<DrawingCommand, 'schemaVersion' | 'id' | 'confidence'>,
): DrawingCommand {
  return {
    schemaVersion: 1,
    id: 'command-1',
    confidence: 1,
    ...input,
  }
}

function projectWithLayers(): Project {
  let project = createProject('测试', factory)
  const sun = createLayer(
    project,
    {
      id: 'sun',
      name: '太阳',
      type: 'preset',
      source: 'preset',
      width: 200,
      height: 200,
      createdBy: 'voice',
    },
    { now: () => now },
  )
  project = addLayer(project, sun, now)
  const tree = createLayer(
    project,
    {
      id: 'tree',
      name: '树',
      type: 'preset',
      source: 'preset',
      width: 220,
      height: 320,
      createdBy: 'voice',
    },
    { now: () => now },
  )
  return addLayer(project, tree, now)
}

describe('executeCommand', () => {
  it('resolves an explicit name before the current selection', () => {
    const result = executeCommand(
      projectWithLayers(),
      command({
        action: 'select',
        target: { name: '太阳' },
        requiresGeneration: false,
      }),
      later,
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.selectedLayerId).toBe('sun')
  })

  it('does not randomly choose among duplicate names', () => {
    let project = projectWithLayers()
    const duplicate = createLayer(
      project,
      {
        id: 'sun-2',
        name: '太阳',
        type: 'preset',
        source: 'preset',
        width: 100,
        height: 100,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, duplicate, now)

    const result = executeCommand(
      project,
      command({
        action: 'delete',
        target: { name: '太阳' },
        requiresGeneration: false,
      }),
    )

    expect(result).toMatchObject({ ok: false, code: 'AMBIGUOUS_TARGET' })
    expect(project.layers).toHaveLength(3)
  })

  it('moves and scales a layer while keeping it inside the canvas', () => {
    const result = executeCommand(
      projectWithLayers(),
      command({
        action: 'modify',
        target: { id: 'sun' },
        properties: { position: 'top-right', size: 'larger', rotation: 15 },
        requiresGeneration: false,
      }),
      later,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sun = result.project.layers.find((layer) => layer.id === 'sun')
    expect(sun).toMatchObject({ width: 230, height: 230, rotation: 15 })
    expect(sun?.x).toBeGreaterThanOrEqual(0)
    expect((sun?.x ?? 0) + (sun?.width ?? 0)).toBeLessThanOrEqual(1024)
  })

  it('moves a generated object by its custom name', () => {
    let project = createProject('测试', factory)
    const horse = createLayer(
      project,
      {
        id: 'horse',
        name: '奔跑的马',
        type: 'image',
        source: 'generated',
        width: 320,
        height: 320,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, horse, now)

    const result = executeCommand(
      project,
      command({
        action: 'modify',
        target: { name: '奔跑的马' },
        properties: { position: 'left' },
        requiresGeneration: false,
      }),
      later,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.layers[0]).toMatchObject({
      id: 'horse',
      x: 48,
      y: 224,
    })
  })

  it('deletes the selected layer and chooses a stable fallback', () => {
    const result = executeCommand(
      projectWithLayers(),
      command({
        action: 'delete',
        target: { reference: 'selected' },
        requiresGeneration: false,
      }),
      later,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.layers.map((layer) => layer.id)).toEqual(['sun'])
    expect(result.project.selectedLayerId).toBe('sun')
    expect(result.project.recentLayerIds).toEqual(['sun'])
  })

  it('keeps the original project unchanged when a locked layer is modified', () => {
    const project = projectWithLayers()
    project.layers[0] = { ...project.layers[0]!, locked: true }
    const snapshot = structuredClone(project)

    const result = executeCommand(
      project,
      command({
        action: 'modify',
        target: { id: 'sun' },
        properties: { size: 'smaller' },
        requiresGeneration: false,
      }),
    )

    expect(result).toMatchObject({ ok: false, code: 'LOCKED_LAYER' })
    expect(project).toEqual(snapshot)
  })

  it('normalizes z-indexes when moving a layer to the front', () => {
    const result = executeCommand(
      projectWithLayers(),
      command({
        action: 'reorder',
        target: { id: 'sun' },
        properties: { zOrder: 'front' },
        requiresGeneration: false,
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.layers.map((layer) => layer.id)).toEqual([
      'tree',
      'sun',
    ])
    expect(result.project.layers.map((layer) => layer.zIndex)).toEqual([0, 1])
  })

  it('edits text content and styling locally', () => {
    let project = createProject('测试', factory)
    project = addLayer(
      project,
      createLayer(
        project,
        {
          id: 'title',
          name: '标题',
          type: 'text',
          source: 'user',
          textContent: '旧标题',
          width: 400,
          height: 120,
          createdBy: 'voice',
        },
        { now: () => now },
      ),
      now,
    )

    const result = executeCommand(
      project,
      command({
        action: 'modify',
        target: { id: 'title' },
        properties: {
          text: '今天也要开心',
          color: '#ef4444',
          fontSize: 72,
          fontWeight: 'bold',
        },
        requiresGeneration: false,
      }),
      later,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.layers[0]).toMatchObject({
      textContent: '今天也要开心',
      fill: '#ef4444',
      fontSize: 72,
      fontWeight: 'bold',
      semanticDescription: '文字“今天也要开心”',
    })
  })

  it('moves attached accessory layers with their parent and deletes them together', () => {
    let project = createProject('测试', factory)
    const cat = createLayer(
      project,
      {
        id: 'cat',
        name: '小猫',
        type: 'image',
        source: 'generated',
        width: 300,
        height: 300,
        x: 200,
        y: 200,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, cat, now)
    const scarf = createLayer(
      project,
      {
        id: 'scarf',
        name: '红色围巾',
        type: 'image',
        source: 'generated',
        parentLayerId: 'cat',
        relation: 'attached-to:小猫',
        width: 180,
        height: 66,
        x: 260,
        y: 284,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, scarf, now)

    const moved = executeCommand(
      project,
      command({
        action: 'modify',
        target: { id: 'cat' },
        properties: { position: 'right', size: 'larger' },
        requiresGeneration: false,
      }),
      later,
    )
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    const movedCat = moved.project.layers.find((layer) => layer.id === 'cat')!
    const movedScarf = moved.project.layers.find(
      (layer) => layer.id === 'scarf',
    )!
    expect(movedScarf.parentLayerId).toBe('cat')
    expect(movedScarf.x).toBeGreaterThan(movedCat.x)
    expect(movedScarf.width).toBeCloseTo(207)

    const deleted = executeCommand(
      moved.project,
      command({
        action: 'delete',
        target: { id: 'cat' },
        requiresGeneration: false,
      }),
      later,
    )
    expect(deleted.ok).toBe(true)
    if (deleted.ok) expect(deleted.project.layers).toHaveLength(0)
  })
})
