import type { DrawingCommand, ParseCommandRequest } from '@xiaohua/contracts'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function explicitlyEditsName(text: string, name: string) {
  const subject = escapeRegExp(name)
  const mutation =
    '(?:重新生成|重新画|重画|重绘|画成|改成|变成|换成|涂成|加上|添上)'
  return new RegExp(`(?:把|将|让|给)?${subject}${mutation}`).test(text)
}

function existingTarget(request: ParseCommandRequest, command: DrawingCommand) {
  const layers = request.context.recentLayers
  if (command.target?.id) {
    return layers.find((layer) => layer.id === command.target?.id)
  }
  if (command.target?.name) {
    return layers.find((layer) => layer.name === command.target?.name)
  }

  const named = [...layers]
    .sort((left, right) => right.name.length - left.name.length)
    .find(
      (layer) =>
        request.text.includes(layer.name) &&
        explicitlyEditsName(request.text.replaceAll(/\s+/g, ''), layer.name),
    )
  if (named) return named

  if (
    request.context.selectedLayerId &&
    /(?:把|将|让|给)?(?:它|这个|当前选中的?)(?:重新生成|重新画|重画|重绘|画成|改成|变成|换成|涂成|加上|添上)/.test(
      request.text.replaceAll(/\s+/g, ''),
    )
  ) {
    return layers.find((layer) => layer.id === request.context.selectedLayerId)
  }

  return undefined
}

export function normalizeCommandForContext(
  request: ParseCommandRequest,
  command: DrawingCommand,
): DrawingCommand {
  if (command.action !== 'create') return command

  const target = existingTarget(request, command)
  if (!target) return command

  const text = request.text.replaceAll(/\s+/g, '')
  const explicitEdit =
    explicitlyEditsName(text, target.name) ||
    (command.target?.id === target.id &&
      /(?:重新|修改|编辑|改成|变成|换成|画成|重画|重绘|加上|添上)/.test(text))
  if (!explicitEdit) return command

  return {
    ...command,
    action: 'modify',
    target: { id: target.id },
    prompt: request.text,
    objects: undefined,
    objectType: undefined,
    properties: undefined,
    requiresGeneration: true,
  }
}
