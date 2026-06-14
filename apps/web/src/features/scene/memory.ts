import type { Layer, Project } from '@xiaohua/contracts'

const colorNames: Array<[RegExp, string]> = [
  [/红|\bred\b|#dc2626|#b91c1c/i, '红色'],
  [/橙|\borange\b|#ea580c|#e0a44a/i, '橙色'],
  [/黄|金|\byellow\b|\bgold(?:en)?\b|#eab308|#ca8a04/i, '黄色'],
  [/绿|草|树|\bgreen\b|#16a34a|#506f4b|#66845d|#78936c/i, '绿色'],
  [/蓝|\bblue\b|#2563eb/i, '蓝色'],
  [/紫|\bpurple\b|\bviolet\b|#9333ea|#7c3aed/i, '紫色'],
  [/粉|\bpink\b|#ec4899/i, '粉色'],
  [/黑|\bblack\b|#111827/i, '黑色'],
  [/白|\bwhite\b|#fff|#f8fafc/i, '白色'],
]

function layerPosition(layer: Layer, project: Project) {
  const centerX = layer.x + layer.width / 2
  const centerY = layer.y + layer.height / 2
  const horizontal =
    centerX < project.canvas.width * 0.35
      ? '左侧'
      : centerX > project.canvas.width * 0.65
        ? '右侧'
        : '中间'
  const vertical =
    centerY < project.canvas.height * 0.35
      ? '上方'
      : centerY > project.canvas.height * 0.65
        ? '下方'
        : '中部'
  if (horizontal === '中间' && vertical === '中部') return '画面中央'
  return `${vertical}${horizontal === '中间' ? '' : horizontal}`
}

function isSceneLayer(layer: Layer, project: Project) {
  const coverage =
    (layer.width * layer.height) /
    (project.canvas.width * project.canvas.height)
  return (
    coverage > 0.68 ||
    /背景|草地|草原|天空|地面|海面|森林|山|河|路/.test(layer.name)
  )
}

function layerDescription(layer: Layer, project: Project) {
  if (layer.type === 'text') {
    return `文字“${layer.textContent ?? layer.name}”位于${layerPosition(layer, project)}`
  }
  const semantic = layer.semanticDescription?.trim()
  return `${layer.name}位于${layerPosition(layer, project)}${
    semantic ? `，内容：${semantic.slice(0, 160)}` : ''
  }`
}

function inferPalette(project: Project) {
  const raw = project.layers.flatMap((layer) => [
    layer.name,
    layer.fill,
    layer.prompt,
    layer.semanticDescription,
  ])
  const palette = colorNames
    .filter(([pattern]) => raw.some((value) => value && pattern.test(value)))
    .map(([, name]) => name)
  return [...new Set([...palette, ...project.memory.palette])].slice(0, 12)
}

function inferLighting(project: Project) {
  const source = [
    project.globalStyle,
    project.memory.creativeDirection,
    project.memory.sceneSummary,
    ...project.layers.flatMap((layer) => [
      layer.name,
      layer.prompt,
      layer.semanticDescription,
    ]),
  ].join(' ')
  if (/夜|月亮|星|night|moon|dark/i.test(source)) return '夜晚柔和光线'
  if (/夕阳|黄昏|sunset|dusk/i.test(source)) return '黄昏暖光'
  if (/阳光|太阳|daylight|bright|warm/i.test(source)) return '明亮暖光'
  return project.memory.lighting || '柔和均匀光线'
}

function relationSummary(project: Project) {
  const layerRelations = project.layers
    .filter((layer) => layer.parentLayerId || layer.relation)
    .map((layer) => {
      const parent = project.layers.find(
        (candidate) => candidate.id === layer.parentLayerId,
      )
      if (parent) return `${layer.name}附着在${parent.name}上`
      const relation = layer.relation?.match(
        /^(left|right|top|bottom|center)-of:(.+)$/,
      )
      if (relation) {
        const direction =
          relation[1] === 'left'
            ? '左侧'
            : relation[1] === 'right'
              ? '右侧'
              : relation[1] === 'top'
                ? '上方'
                : relation[1] === 'bottom'
                  ? '下方'
                  : '附近'
        return `${layer.name}在${relation[2]}${direction}`
      }
      return layer.relation
        ? `${layer.name}关系：${layer.relation}`
        : layer.name
    })
  const groups = new Map<string, string[]>()
  for (const layer of project.layers) {
    if (!layer.groupId) continue
    groups.set(layer.groupId, [
      ...(groups.get(layer.groupId) ?? []),
      layer.name,
    ])
  }
  const groupRelations = [...groups.values()]
    .filter((names) => names.length > 1)
    .map((names) => `${names.join('与')}属于同一组合`)
  return [...layerRelations, ...groupRelations]
}

export function refreshProjectSceneMemory(project: Project): Project {
  const visibleLayers = [...project.layers]
    .filter((layer) => layer.visible)
    .sort((left, right) => left.zIndex - right.zIndex)
  const sceneLayers = visibleLayers.filter((layer) =>
    isSceneLayer(layer, project),
  )
  const foregroundLayers = visibleLayers.filter(
    (layer) =>
      layer.type !== 'text' &&
      !isSceneLayer(layer, project) &&
      !layer.parentLayerId,
  )
  const textLayers = visibleLayers.filter((layer) => layer.type === 'text')
  const relationParts = relationSummary(project)
  const focus =
    foregroundLayers
      .sort(
        (left, right) => right.width * right.height - left.width * left.height,
      )
      .at(0)?.name ?? textLayers.at(0)?.name

  const parts = [
    sceneLayers.length
      ? `场景层：${sceneLayers.map((layer) => layer.name).join('、')}`
      : '',
    foregroundLayers.length
      ? `主体：${foregroundLayers
          .map((layer) => layerDescription(layer, project))
          .join('；')}`
      : '',
    textLayers.length
      ? `文字：${textLayers
          .map((layer) => layerDescription(layer, project))
          .join('；')}`
      : '',
    relationParts.length ? `关系：${relationParts.join('；')}` : '',
    focus ? `当前视觉焦点是${focus}` : '',
  ].filter(Boolean)

  const sceneSummary =
    parts.join('。').slice(0, 1800) ||
    project.memory.sceneSummary ||
    '空白画布，等待用户开始创作'

  return {
    ...project,
    memory: {
      ...project.memory,
      creativeDirection:
        project.memory.creativeDirection ||
        project.globalStyle ||
        '保持统一、清晰、适合继续编辑的现代智能插画方向',
      sceneSummary,
      palette: inferPalette(project),
      lighting: inferLighting(project),
    },
  }
}
