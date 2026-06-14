import type { DrawingCommand, Layer, Project } from '@xiaohua/contracts'
import { constrainLayer, normalizeLayers } from '../project/model'
import { resolveTarget, type TargetResolution } from './resolveTarget'

export type CommandFailure =
  | Extract<TargetResolution, { ok: false }>
  | {
      ok: false
      code: 'UNSUPPORTED_COMMAND' | 'LOCKED_LAYER'
      message: string
    }

export type CommandResult =
  | { ok: true; project: Project; message: string }
  | CommandFailure

function replaceLayer(
  project: Project,
  nextLayer: Layer,
  now: string,
): Project {
  const previousLayer = project.layers.find(
    (layer) => layer.id === nextLayer.id,
  )
  const scaleX = previousLayer ? nextLayer.width / previousLayer.width : 1
  const scaleY = previousLayer ? nextLayer.height / previousLayer.height : 1
  const rotationDelta = previousLayer
    ? nextLayer.rotation - previousLayer.rotation
    : 0
  const groupedLayerIds = new Set(
    previousLayer?.groupId
      ? project.layers
          .filter((layer) => layer.groupId === previousLayer.groupId)
          .map((layer) => layer.id)
      : [nextLayer.id],
  )
  return {
    ...project,
    layers: project.layers.map((layer) => {
      if (layer.id === nextLayer.id) return nextLayer
      const movesWithTarget =
        previousLayer &&
        (layer.parentLayerId === nextLayer.id ||
          (previousLayer.groupId && layer.groupId === previousLayer.groupId) ||
          (layer.parentLayerId && groupedLayerIds.has(layer.parentLayerId)))
      if (!movesWithTarget || !previousLayer) return layer
      return constrainLayer(
        {
          ...layer,
          x: nextLayer.x + (layer.x - previousLayer.x) * scaleX,
          y: nextLayer.y + (layer.y - previousLayer.y) * scaleY,
          width: layer.width * scaleX,
          height: layer.height * scaleY,
          rotation: layer.rotation + rotationDelta,
          updatedAt: now,
        },
        project,
      )
    }),
    selectedLayerId: nextLayer.id,
    recentLayerIds: [
      nextLayer.id,
      ...project.recentLayerIds.filter((id) => id !== nextLayer.id),
    ].slice(0, 20),
    updatedAt: now,
  }
}

function positionLayer(
  layer: Layer,
  project: Project,
  position: string,
): Layer {
  const margin = 48
  const horizontalCenter = (project.canvas.width - layer.width) / 2
  const verticalCenter = (project.canvas.height - layer.height) / 2
  const positions: Record<string, Pick<Layer, 'x' | 'y'>> = {
    left: { x: margin, y: verticalCenter },
    center: { x: horizontalCenter, y: verticalCenter },
    right: {
      x: project.canvas.width - layer.width - margin,
      y: verticalCenter,
    },
    top: { x: horizontalCenter, y: margin },
    bottom: {
      x: horizontalCenter,
      y: project.canvas.height - layer.height - margin,
    },
    'top-left': { x: margin, y: margin },
    'top-right': {
      x: project.canvas.width - layer.width - margin,
      y: margin,
    },
    'bottom-left': {
      x: margin,
      y: project.canvas.height - layer.height - margin,
    },
    'bottom-right': {
      x: project.canvas.width - layer.width - margin,
      y: project.canvas.height - layer.height - margin,
    },
  }
  return { ...layer, ...(positions[position] ?? {}) }
}

function reorderLayer(
  layers: Layer[],
  targetId: string,
  direction: NonNullable<NonNullable<DrawingCommand['properties']>['zOrder']>,
): Layer[] {
  const ordered = normalizeLayers(layers)
  const index = ordered.findIndex((layer) => layer.id === targetId)
  if (index < 0) return ordered
  const [target] = ordered.splice(index, 1)
  if (!target) return ordered

  const destination = {
    front: ordered.length,
    back: 0,
    up: Math.min(index + 1, ordered.length),
    down: Math.max(index - 1, 0),
  }[direction]
  ordered.splice(destination, 0, target)
  return ordered.map((layer, zIndex) => ({ ...layer, zIndex }))
}

export function executeCommand(
  project: Project,
  command: DrawingCommand,
  now = new Date().toISOString(),
  id: () => string = () => crypto.randomUUID(),
): CommandResult {
  if (command.action === 'save') {
    return {
      ok: true,
      project: {
        ...project,
        layers: normalizeLayers(project.layers),
        updatedAt: now,
      },
      message: '作品已准备导出',
    }
  }

  if (
    ['create', 'confirm', 'cancel', 'undo', 'redo'].includes(command.action)
  ) {
    return {
      ok: false,
      code: 'UNSUPPORTED_COMMAND',
      message: '该命令需要由对应流程处理',
    }
  }

  if (command.action === 'group') {
    const groupLayerIds = [...new Set(command.target?.ids ?? [])]
    if (groupLayerIds.length < 2) {
      return {
        ok: false,
        code: 'UNSUPPORTED_COMMAND',
        message: '请至少指定两个需要组合的对象',
      }
    }
    const groupLayers = project.layers.filter((layer) =>
      groupLayerIds.includes(layer.id),
    )
    if (groupLayers.length !== groupLayerIds.length) {
      return {
        ok: false,
        code: 'UNSUPPORTED_COMMAND',
        message: '部分组合对象不存在',
      }
    }
    if (groupLayers.some((layer) => layer.locked)) {
      return { ok: false, code: 'LOCKED_LAYER', message: '组合中包含锁定图层' }
    }
    const groupId = id()
    return {
      ok: true,
      project: {
        ...project,
        layers: project.layers.map((layer) =>
          groupLayerIds.includes(layer.id)
            ? { ...layer, groupId, updatedAt: now }
            : layer,
        ),
        selectedLayerId: groupLayerIds[0] ?? null,
        recentLayerIds: [
          ...groupLayerIds,
          ...project.recentLayerIds.filter(
            (layerId) => !groupLayerIds.includes(layerId),
          ),
        ].slice(0, 20),
        updatedAt: now,
      },
      message: `已组合${groupLayers.map((layer) => layer.name).join('和')}`,
    }
  }

  const resolution = resolveTarget(project, command.target)
  if (!resolution.ok) return resolution
  const target = resolution.layer

  const explicitlyUnlocking =
    command.action === 'modify' && command.properties?.locked === false
  if (target.locked && command.action !== 'select' && !explicitlyUnlocking) {
    return { ok: false, code: 'LOCKED_LAYER', message: '目标图层已锁定' }
  }

  if (command.action === 'select') {
    return {
      ok: true,
      project: {
        ...project,
        selectedLayerId: target.id,
        recentLayerIds: [
          target.id,
          ...project.recentLayerIds.filter((id) => id !== target.id),
        ],
        updatedAt: now,
      },
      message: `已选择${target.name}`,
    }
  }

  if (command.action === 'ungroup') {
    if (!target.groupId) {
      return {
        ok: false,
        code: 'UNSUPPORTED_COMMAND',
        message: `${target.name}当前不在组合中`,
      }
    }
    const groupId = target.groupId
    return {
      ok: true,
      project: {
        ...project,
        layers: project.layers.map((layer) => {
          if (layer.groupId !== groupId) return layer
          const ungrouped = { ...layer }
          delete ungrouped.groupId
          return { ...ungrouped, updatedAt: now }
        }),
        selectedLayerId: target.id,
        updatedAt: now,
      },
      message: '已取消对象组合',
    }
  }

  if (command.action === 'delete') {
    const removedIds = new Set([
      target.id,
      ...project.layers
        .filter((layer) => layer.parentLayerId === target.id)
        .map((layer) => layer.id),
    ])
    const remaining = normalizeLayers(
      project.layers.filter((layer) => !removedIds.has(layer.id)),
    )
    const fallback = remaining.at(-1)?.id ?? null
    return {
      ok: true,
      project: {
        ...project,
        layers: remaining,
        selectedLayerId:
          project.selectedLayerId && removedIds.has(project.selectedLayerId)
            ? fallback
            : project.selectedLayerId,
        recentLayerIds: project.recentLayerIds.filter(
          (id) => !removedIds.has(id),
        ),
        updatedAt: now,
      },
      message: `已删除${target.name}`,
    }
  }

  if (command.action === 'duplicate') {
    const children = project.layers.filter(
      (layer) => layer.parentLayerId === target.id,
    )
    const targetId = id()
    const offset = 28
    const duplicateLayer = (layer: Layer, nextId: string): Layer => {
      const copy = {
        ...layer,
        id: nextId,
        name: layer.id === target.id ? `${layer.name} 副本` : layer.name,
        x: layer.x + offset,
        y: layer.y + offset,
        zIndex: project.layers.length,
        createdAt: now,
        updatedAt: now,
        ...(layer.parentLayerId ? { parentLayerId: targetId } : {}),
      }
      delete copy.groupId
      return constrainLayer(copy, project)
    }
    const copies = [
      duplicateLayer(target, targetId),
      ...children.map((layer) => duplicateLayer(layer, id())),
    ]
    const layers = normalizeLayers([...project.layers, ...copies])
    return {
      ok: true,
      project: {
        ...project,
        layers,
        selectedLayerId: targetId,
        recentLayerIds: [
          targetId,
          ...project.recentLayerIds.filter((layerId) => layerId !== targetId),
        ].slice(0, 20),
        updatedAt: now,
      },
      message: `已复制${target.name}`,
    }
  }

  if (command.action === 'reorder') {
    const zOrder = command.properties?.zOrder
    if (!zOrder) {
      return {
        ok: false,
        code: 'UNSUPPORTED_COMMAND',
        message: '请说明图层调整方向',
      }
    }
    return {
      ok: true,
      project: {
        ...project,
        layers: reorderLayer(project.layers, target.id, zOrder),
        selectedLayerId: target.id,
        updatedAt: now,
      },
      message: `已调整${target.name}的图层顺序`,
    }
  }

  let nextLayer = { ...target, updatedAt: now }
  if (command.action === 'rename') {
    const name = command.properties?.name
    if (!name) {
      return {
        ok: false,
        code: 'UNSUPPORTED_COMMAND',
        message: '请提供新的图层名称',
      }
    }
    nextLayer.name = name
  } else if (command.action === 'modify') {
    const properties = command.properties
    if (properties?.position) {
      nextLayer = positionLayer(nextLayer, project, properties.position)
    }
    if (properties?.x !== undefined) nextLayer.x = properties.x
    if (properties?.y !== undefined) nextLayer.y = properties.y
    if (properties?.width !== undefined) nextLayer.width = properties.width
    if (properties?.height !== undefined) nextLayer.height = properties.height
    const scale =
      properties?.scaleDelta ??
      (properties?.size === 'larger'
        ? 0.15
        : properties?.size === 'smaller'
          ? -0.15
          : 0)
    if (scale !== 0) {
      const centerX = nextLayer.x + nextLayer.width / 2
      const centerY = nextLayer.y + nextLayer.height / 2
      nextLayer.width *= 1 + scale
      nextLayer.height *= 1 + scale
      nextLayer.x = centerX - nextLayer.width / 2
      nextLayer.y = centerY - nextLayer.height / 2
    }
    if (properties?.rotation !== undefined) {
      nextLayer.rotation = properties.rotation
    }
    if (properties?.rotationDelta !== undefined) {
      nextLayer.rotation += properties.rotationDelta
    }
    if (properties?.text !== undefined && nextLayer.type === 'text') {
      nextLayer.textContent = properties.text
      nextLayer.semanticDescription = `文字“${properties.text}”`
    }
    if (properties?.color !== undefined) nextLayer.fill = properties.color
    if (properties?.fontFamily !== undefined) {
      nextLayer.fontFamily = properties.fontFamily
    }
    if (properties?.fontSize !== undefined) {
      nextLayer.fontSize = properties.fontSize
    }
    if (properties?.fontWeight !== undefined) {
      nextLayer.fontWeight = properties.fontWeight
    }
    if (properties?.align !== undefined) nextLayer.align = properties.align
    if (properties?.stroke !== undefined) nextLayer.stroke = properties.stroke
    if (properties?.strokeWidth !== undefined) {
      nextLayer.strokeWidth = properties.strokeWidth
    }
    if (properties?.opacity !== undefined) {
      nextLayer.opacity = properties.opacity
    }
    if (properties?.opacityDelta !== undefined) {
      nextLayer.opacity = Math.min(
        1,
        Math.max(0, nextLayer.opacity + properties.opacityDelta),
      )
    }
    if (properties?.visible !== undefined) {
      nextLayer.visible = properties.visible
    }
    if (properties?.locked !== undefined) {
      nextLayer.locked = properties.locked
    }
    if (properties?.name) nextLayer.name = properties.name
  }

  nextLayer = constrainLayer(nextLayer, project)
  return {
    ok: true,
    project: replaceLayer(project, nextLayer, now),
    message: `已更新${nextLayer.name}`,
  }
}
