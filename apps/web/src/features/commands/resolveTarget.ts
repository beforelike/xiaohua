import type { DrawingCommand, Layer, Project } from '@xiaohua/contracts'

export type TargetResolution =
  | { ok: true; layer: Layer }
  | {
      ok: false
      code: 'TARGET_REQUIRED' | 'TARGET_NOT_FOUND' | 'AMBIGUOUS_TARGET'
      message: string
      candidates?: Layer[]
    }

export function resolveTarget(
  project: Project,
  target: DrawingCommand['target'],
): TargetResolution {
  if (target?.id) {
    const layer = project.layers.find((candidate) => candidate.id === target.id)
    return layer
      ? { ok: true, layer }
      : { ok: false, code: 'TARGET_NOT_FOUND', message: '未找到目标图层' }
  }

  if (target?.name) {
    const matches = project.layers.filter(
      (candidate) => candidate.name === target.name,
    )
    if (matches.length === 1 && matches[0]) {
      return { ok: true, layer: matches[0] }
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: 'AMBIGUOUS_TARGET',
        message: `找到多个名为“${target.name}”的图层，请进一步说明`,
        candidates: matches,
      }
    }
  }

  if (
    target?.reference === 'selected' ||
    (!target?.reference && project.selectedLayerId)
  ) {
    const selected = project.layers.find(
      (candidate) => candidate.id === project.selectedLayerId,
    )
    if (selected) return { ok: true, layer: selected }
  }

  if (target?.reference === 'recent') {
    for (const id of project.recentLayerIds) {
      const recent = project.layers.find((candidate) => candidate.id === id)
      if (recent) return { ok: true, layer: recent }
    }
  }

  return {
    ok: false,
    code: target?.name ? 'TARGET_NOT_FOUND' : 'TARGET_REQUIRED',
    message: target?.name ? `未找到“${target.name}”` : '请先说明要操作的对象',
  }
}
