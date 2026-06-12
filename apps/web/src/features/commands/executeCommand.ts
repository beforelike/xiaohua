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
  return {
    ...project,
    layers: project.layers.map((layer) =>
      layer.id === nextLayer.id ? nextLayer : layer,
    ),
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

  if (['create', 'confirm', 'cancel'].includes(command.action)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_COMMAND',
      message: '该命令需要由对应流程处理',
    }
  }

  const resolution = resolveTarget(project, command.target)
  if (!resolution.ok) return resolution
  const target = resolution.layer

  if (target.locked && command.action !== 'select') {
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

  if (command.action === 'delete') {
    const remaining = normalizeLayers(
      project.layers.filter((layer) => layer.id !== target.id),
    )
    const fallback = remaining.at(-1)?.id ?? null
    return {
      ok: true,
      project: {
        ...project,
        layers: remaining,
        selectedLayerId:
          project.selectedLayerId === target.id
            ? fallback
            : project.selectedLayerId,
        recentLayerIds: project.recentLayerIds.filter((id) => id !== target.id),
        updatedAt: now,
      },
      message: `已删除${target.name}`,
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
    if (properties?.name) nextLayer.name = properties.name
  }

  nextLayer = constrainLayer(nextLayer, project)
  return {
    ok: true,
    project: replaceLayer(project, nextLayer, now),
    message: `已更新${nextLayer.name}`,
  }
}
