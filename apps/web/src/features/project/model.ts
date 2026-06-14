import {
  projectSchema,
  schemaVersion,
  type Layer,
  type Project,
} from '@xiaohua/contracts'

export const DEFAULT_CANVAS = {
  width: 1024,
  height: 768,
  backgroundColor: '#fffdf7',
} as const

export interface ModelFactoryOptions {
  id?: () => string
  now?: () => string
}

const defaultFactory: Required<ModelFactoryOptions> = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
}

export function createProject(
  title = '未命名作品',
  options: ModelFactoryOptions = {},
): Project {
  const factory = { ...defaultFactory, ...options }
  const now = factory.now()

  return projectSchema.parse({
    schemaVersion,
    id: factory.id(),
    title,
    canvas: DEFAULT_CANVAS,
    globalStyle: '',
    memory: {
      creativeDirection: '',
      sceneSummary: '',
      palette: [],
      lighting: '',
      recentIntents: [],
    },
    characterAssets: [],
    layers: [],
    selectedLayerId: null,
    recentLayerIds: [],
    createdAt: now,
    updatedAt: now,
  })
}

export type NewLayer = Pick<
  Layer,
  'name' | 'type' | 'source' | 'width' | 'height' | 'createdBy'
> &
  Partial<
    Pick<
      Layer,
      | 'id'
      | 'assetUrl'
      | 'prompt'
      | 'negativePrompt'
      | 'semanticDescription'
      | 'generation'
      | 'characterAssetId'
      | 'groupId'
      | 'parentLayerId'
      | 'relation'
      | 'textContent'
      | 'fontFamily'
      | 'fontSize'
      | 'fontWeight'
      | 'fill'
      | 'align'
      | 'stroke'
      | 'strokeWidth'
      | 'status'
      | 'x'
      | 'y'
      | 'rotation'
      | 'opacity'
      | 'visible'
      | 'locked'
    >
  >

export function createLayer(
  project: Project,
  input: NewLayer,
  options: ModelFactoryOptions = {},
): Layer {
  const factory = { ...defaultFactory, ...options }
  const now = factory.now()
  const width = Math.min(input.width, project.canvas.width)
  const height = Math.min(input.height, project.canvas.height)

  return {
    id: input.id ?? factory.id(),
    name: input.name,
    type: input.type,
    source: input.source,
    status: input.status ?? 'ready',
    x: input.x ?? (project.canvas.width - width) / 2,
    y: input.y ?? (project.canvas.height - height) / 2,
    width,
    height,
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    zIndex: project.layers.length,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    ...(input.assetUrl ? { assetUrl: input.assetUrl } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
    ...(input.semanticDescription
      ? { semanticDescription: input.semanticDescription }
      : {}),
    ...(input.generation ? { generation: input.generation } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.parentLayerId ? { parentLayerId: input.parentLayerId } : {}),
    ...(input.relation ? { relation: input.relation } : {}),
    ...(input.textContent ? { textContent: input.textContent } : {}),
    ...(input.fontFamily ? { fontFamily: input.fontFamily } : {}),
    ...(input.fontSize ? { fontSize: input.fontSize } : {}),
    ...(input.fontWeight ? { fontWeight: input.fontWeight } : {}),
    ...(input.fill ? { fill: input.fill } : {}),
    ...(input.align ? { align: input.align } : {}),
    ...(input.stroke ? { stroke: input.stroke } : {}),
    ...(input.strokeWidth !== undefined
      ? { strokeWidth: input.strokeWidth }
      : {}),
  }
}

export function constrainLayer(layer: Layer, project: Project): Layer {
  const round = (value: number) => Math.round(value * 1000) / 1000
  const width = round(Math.max(24, Math.min(layer.width, project.canvas.width)))
  const height = round(
    Math.max(24, Math.min(layer.height, project.canvas.height)),
  )

  return {
    ...layer,
    width,
    height,
    x: round(Math.max(0, Math.min(layer.x, project.canvas.width - width))),
    y: round(Math.max(0, Math.min(layer.y, project.canvas.height - height))),
  }
}

export function normalizeLayers(layers: Layer[]): Layer[] {
  return [...layers]
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((layer, zIndex) => ({ ...layer, zIndex }))
}

export function addLayer(project: Project, layer: Layer, now: string): Project {
  const layers = normalizeLayers([...project.layers, layer])
  return projectSchema.parse({
    ...project,
    layers,
    selectedLayerId: layer.id,
    recentLayerIds: [
      layer.id,
      ...project.recentLayerIds.filter((id) => id !== layer.id),
    ].slice(0, 20),
    updatedAt: now,
  })
}
