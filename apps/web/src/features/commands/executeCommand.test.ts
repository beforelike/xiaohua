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
  it('groups layers, moves them together, and supports ungrouping', () => {
    let project = projectWithLayers()
    const hat = createLayer(
      project,
      {
        id: 'hat',
        name: '帽子',
        type: 'preset',
        source: 'preset',
        parentLayerId: 'tree',
        width: 80,
        height: 60,
        x: 450,
        y: 190,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, hat, now)
    const sunBefore = project.layers.find((layer) => layer.id === 'sun')!
    const treeBefore = project.layers.find((layer) => layer.id === 'tree')!
    const hatBefore = project.layers.find((layer) => layer.id === 'hat')!
    const grouped = executeCommand(
      project,
      command({
        action: 'group',
        target: { ids: ['sun', 'tree'] },
        requiresGeneration: false,
      }),
      later,
      () => 'group-1',
    )

    expect(grouped.ok).toBe(true)
    if (!grouped.ok) return
    expect(
      grouped.project.layers
        .filter((layer) => ['sun', 'tree'].includes(layer.id))
        .map((layer) => layer.groupId),
    ).toEqual(['group-1', 'group-1'])

    const moved = executeCommand(
      grouped.project,
      command({
        action: 'modify',
        target: { id: 'sun' },
        properties: { x: sunBefore.x + 80, y: sunBefore.y + 40 },
        requiresGeneration: false,
      }),
      later,
    )
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(
      moved.project.layers.find((layer) => layer.id === 'tree'),
    ).toMatchObject({
      x: treeBefore.x + 80,
      y: treeBefore.y + 40,
    })
    expect(
      moved.project.layers.find((layer) => layer.id === 'hat'),
    ).toMatchObject({
      x: hatBefore.x + 80,
      y: hatBefore.y + 40,
    })

    const ungrouped = executeCommand(
      moved.project,
      command({
        action: 'ungroup',
        target: { id: 'sun' },
        requiresGeneration: false,
      }),
      later,
    )
    expect(ungrouped.ok).toBe(true)
    if (!ungrouped.ok) return
    expect(ungrouped.project.layers.every((layer) => !layer.groupId)).toBe(true)
  })

  it('duplicates a layer and its attached children without regenerating assets', () => {
    let project = createProject('测试', factory)
    const parent = createLayer(
      project,
      {
        id: 'tree-parent',
        name: '树',
        type: 'preset',
        source: 'preset',
        assetUrl: 'tree.svg',
        width: 220,
        height: 320,
        x: 100,
        y: 200,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, parent, now)
    const child = createLayer(
      project,
      {
        id: 'tree-hat',
        name: '帽子',
        type: 'preset',
        source: 'preset',
        assetUrl: 'hat.svg',
        parentLayerId: parent.id,
        relation: 'attached-to:树',
        width: 80,
        height: 60,
        x: 170,
        y: 160,
        createdBy: 'voice',
      },
      { now: () => now },
    )
    project = addLayer(project, child, now)
    const ids = ['tree-copy', 'hat-copy'][Symbol.iterator]()

    const result = executeCommand(
      project,
      {
        schemaVersion: 1,
        id: 'duplicate-tree',
        action: 'duplicate',
        target: { id: parent.id },
        requiresGeneration: false,
        confidence: 1,
      },
      now,
      () => ids.next().value!,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.layers).toHaveLength(4)
    expect(
      result.project.layers.find((layer) => layer.id === 'tree-copy'),
    ).toMatchObject({
      name: '树 副本',
      assetUrl: 'tree.svg',
      x: 128,
      y: 228,
    })
    expect(
      result.project.layers.find((layer) => layer.id === 'hat-copy'),
    ).toMatchObject({
      assetUrl: 'hat.svg',
      parentLayerId: 'tree-copy',
      x: 198,
      y: 188,
    })
    expect(result.project.selectedLayerId).toBe('tree-copy')
  })

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
