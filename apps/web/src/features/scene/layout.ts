import type { Layer, Project, SceneObject } from '@xiaohua/contracts'

export type SceneLayout = Pick<Layer, 'x' | 'y' | 'width' | 'height'>
export type GenerationSize = Pick<Layer, 'width' | 'height'>

type ScenePosition = SceneObject['position']
type SceneSize = SceneObject['size']

interface LayoutInput {
  name: string
  position?: ScenePosition
  size?: SceneSize
  isBackground?: boolean
  avoidLayers?: Layer[]
}

type GroupLayoutInput = Pick<
  SceneObject,
  'name' | 'position' | 'size' | 'isBackground'
>

const margin = 48
const relationGap = 18
const minGenerationSide = 256
const maxGenerationSide = 1024
const generationStep = 64
const sizeRatio: Record<SceneSize, number> = {
  small: 0.2,
  medium: 0.32,
  large: 0.48,
  full: 1,
}

const positionRank: Record<ScenePosition, number> = {
  'top-left': 0,
  left: 1,
  'bottom-left': 2,
  top: 3,
  center: 4,
  bottom: 5,
  'top-right': 6,
  right: 7,
  'bottom-right': 8,
}

const positionPreference: Record<ScenePosition, ScenePosition[]> = {
  'top-left': ['top-left', 'top', 'left', 'center'],
  top: ['top', 'top-left', 'top-right', 'center'],
  'top-right': ['top-right', 'top', 'right', 'center'],
  left: ['left', 'top-left', 'bottom-left', 'center'],
  center: [
    'center',
    'right',
    'left',
    'bottom',
    'top',
    'bottom-right',
    'bottom-left',
    'top-right',
    'top-left',
  ],
  right: ['right', 'top-right', 'bottom-right', 'center'],
  'bottom-left': ['bottom-left', 'bottom', 'left', 'center'],
  bottom: ['bottom', 'bottom-left', 'bottom-right', 'center'],
  'bottom-right': ['bottom-right', 'bottom', 'right', 'center'],
}

function candidateLayout(
  project: Project,
  position: ScenePosition,
  width: number,
  height: number,
): SceneLayout {
  const horizontalCenter = (project.canvas.width - width) / 2
  const verticalCenter = (project.canvas.height - height) / 2
  const positions: Record<ScenePosition, Pick<Layer, 'x' | 'y'>> = {
    'top-left': { x: margin, y: margin },
    top: { x: horizontalCenter, y: margin },
    'top-right': { x: project.canvas.width - width - margin, y: margin },
    left: { x: margin, y: verticalCenter },
    center: { x: horizontalCenter, y: verticalCenter },
    right: { x: project.canvas.width - width - margin, y: verticalCenter },
    'bottom-left': { x: margin, y: project.canvas.height - height - margin },
    bottom: { x: horizontalCenter, y: project.canvas.height - height - margin },
    'bottom-right': {
      x: project.canvas.width - width - margin,
      y: project.canvas.height - height - margin,
    },
  }
  return { ...positions[position], width, height }
}

function area(rect: SceneLayout) {
  return rect.width * rect.height
}

function overlapArea(left: SceneLayout, right: SceneLayout) {
  const x = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  )
  const y = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y),
  )
  return x * y
}

function isBackgroundLike(layer: Layer, project: Project) {
  const coverage = area(layer) / (project.canvas.width * project.canvas.height)
  return (
    coverage > 0.68 ||
    /背景|草地|草原|天空|地面|海面|森林|山|河|路/.test(layer.name) ||
    layer.relation === 'background'
  )
}

function scoreLayout(layout: SceneLayout, project: Project, layers: Layer[]) {
  const layoutArea = area(layout)
  return layers.reduce((score, layer) => {
    if (!layer.visible || isBackgroundLike(layer, project)) return score
    const overlap = overlapArea(layout, layer) / Math.max(1, layoutArea)
    const weight = layer.type === 'text' ? 3.2 : layer.parentLayerId ? 1.5 : 2
    return score + overlap * weight
  }, 0)
}

export function planSceneObjectLayout(
  project: Project,
  input: LayoutInput,
): SceneLayout {
  const requestedSize = input.size ?? 'medium'
  if (input.isBackground || requestedSize === 'full') {
    return {
      x: 0,
      y: 0,
      width: project.canvas.width,
      height: project.canvas.height,
    }
  }

  const width = Math.round(project.canvas.width * sizeRatio[requestedSize])
  const height = width
  const requestedPosition = input.position ?? 'center'
  const avoidLayers = input.avoidLayers ?? project.layers
  const candidates = positionPreference[requestedPosition].map(
    (position, index) => {
      const layout = candidateLayout(project, position, width, height)
      return {
        layout,
        score:
          scoreLayout(layout, project, avoidLayers) +
          index * 0.035 +
          (position === requestedPosition ? 0 : 0.08),
      }
    },
  )

  return candidates.sort((left, right) => left.score - right.score)[0]!.layout
}

function groupForegroundSide(
  project: Project,
  input: GroupLayoutInput,
  foregroundCount: number,
) {
  const requestedSize = input.size ?? 'medium'
  const baseRatio = sizeRatio[requestedSize]
  const groupRatio =
    foregroundCount <= 1
      ? baseRatio
      : foregroundCount === 2
        ? Math.min(baseRatio, 0.28)
        : foregroundCount === 3
          ? Math.min(baseRatio, 0.24)
          : Math.min(baseRatio, 0.2)
  return Math.round(project.canvas.width * groupRatio)
}

function groupForegroundY(
  project: Project,
  position: ScenePosition | undefined,
  side: number,
) {
  if (position?.startsWith('top') || position === 'top') return margin
  if (position?.startsWith('bottom') || position === 'bottom') {
    return project.canvas.height - side - margin
  }
  return project.canvas.height - side - Math.round(project.canvas.height * 0.16)
}

export function planSceneObjectLayouts(
  project: Project,
  objects: GroupLayoutInput[],
  avoidLayers: Layer[] = project.layers,
): SceneLayout[] {
  const layouts = new Array<SceneLayout>(objects.length)
  const foregroundEntries = objects
    .map((object, index) => ({ object, index }))
    .filter(
      ({ object }) => !object.isBackground && (object.size ?? 'medium') !== 'full',
    )

  objects.forEach((object, index) => {
    if (object.isBackground || object.size === 'full') {
      layouts[index] = {
        x: 0,
        y: 0,
        width: project.canvas.width,
        height: project.canvas.height,
      }
    }
  })

  if (foregroundEntries.length === 0) return layouts
  if (foregroundEntries.length === 1) {
    const [{ object, index }] = foregroundEntries
    layouts[index] = planSceneObjectLayout(project, {
      ...object,
      avoidLayers,
    })
    return layouts
  }

  const ordered = [...foregroundEntries].sort((left, right) => {
    const leftRank = positionRank[left.object.position ?? 'center']
    const rightRank = positionRank[right.object.position ?? 'center']
    return leftRank - rightRank || left.index - right.index
  })
  const sides = ordered.map(({ object }) =>
    groupForegroundSide(project, object, foregroundEntries.length),
  )
  const maxSide = Math.max(...sides)
  const gap = Math.max(24, Math.round(project.canvas.width * 0.04))
  const totalWidth =
    sides.reduce((sum, side) => sum + side, 0) + gap * (sides.length - 1)
  const availableWidth = project.canvas.width - margin * 2
  const scale = Math.min(1, availableWidth / Math.max(1, totalWidth))
  const scaledSides = sides.map((side) => Math.round(side * scale))
  const scaledGap = Math.round(gap * scale)
  const scaledTotalWidth =
    scaledSides.reduce((sum, side) => sum + side, 0) +
    scaledGap * (scaledSides.length - 1)
  let cursorX = Math.round((project.canvas.width - scaledTotalWidth) / 2)

  ordered.forEach(({ object, index }, orderIndex) => {
    const side = scaledSides[orderIndex] ?? maxSide
    const layout = {
      x: cursorX,
      y: groupForegroundY(project, object.position, side),
      width: side,
      height: side,
    }
    layouts[index] = layout
    cursorX += side + scaledGap
  })

  return layouts
}

export function planGeneratedLayerLayout(
  project: Project,
  input: {
    name?: string
    position?: string
    width: number
    height: number
    avoidLayers?: Layer[]
  },
): SceneLayout {
  const position = (
    input.position &&
    Object.hasOwn(positionPreference, input.position) &&
    input.position
      ? input.position
      : 'center'
  ) as ScenePosition
  const candidates = positionPreference[position].map((candidate, index) => {
    const layout = candidateLayout(
      project,
      candidate,
      input.width,
      input.height,
    )
    return {
      layout,
      score:
        scoreLayout(layout, project, input.avoidLayers ?? project.layers) +
        index * 0.035 +
        (candidate === position ? 0 : 0.08),
    }
  })
  return candidates.sort((left, right) => left.score - right.score)[0]!.layout
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function roundGenerationSide(value: number) {
  return clamp(
    Math.round(value / generationStep) * generationStep,
    minGenerationSide,
    maxGenerationSide,
  )
}

export function generationSizeForLayout(
  layout: GenerationSize,
): GenerationSize {
  const width = Math.max(1, layout.width)
  const height = Math.max(1, layout.height)
  const scaleUp = Math.max(1, minGenerationSide / Math.min(width, height))
  const scaleDown = Math.min(
    1,
    maxGenerationSide / Math.max(width * scaleUp, height * scaleUp),
  )
  const scale = scaleUp * scaleDown

  return {
    width: roundGenerationSide(width * scale),
    height: roundGenerationSide(height * scale),
  }
}

export function planLayerRelativeToTarget(
  project: Project,
  target: Layer,
  input: {
    position?: string
    width: number
    height: number
  },
): SceneLayout {
  const position = (
    input.position &&
    Object.hasOwn(positionPreference, input.position) &&
    input.position
      ? input.position
      : 'right'
  ) as ScenePosition
  const centeredX = target.x + target.width / 2 - input.width / 2
  const centeredY = target.y + target.height / 2 - input.height / 2
  const raw: Pick<Layer, 'x' | 'y'> =
    position === 'left'
      ? { x: target.x - input.width - relationGap, y: centeredY }
      : position === 'right'
        ? { x: target.x + target.width + relationGap, y: centeredY }
        : position === 'top'
          ? { x: centeredX, y: target.y - input.height - relationGap }
          : position === 'bottom'
            ? { x: centeredX, y: target.y + target.height + relationGap }
            : candidateLayout(project, position, input.width, input.height)

  return {
    x: clamp(raw.x, margin, project.canvas.width - input.width - margin),
    y: clamp(raw.y, margin, project.canvas.height - input.height - margin),
    width: input.width,
    height: input.height,
  }
}
