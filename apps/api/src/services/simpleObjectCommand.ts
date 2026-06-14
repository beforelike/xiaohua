import type { DrawingCommand, SceneObject } from '@xiaohua/contracts'
import { findPreset } from './promptPresets'

const SCENE_OR_RELATION =
  /(?:背景|场景|草原|草地|草坪|森林|树林|河边|河流|小溪|溪流|湖边|湖泊|海边|海洋|天空|云层|山谷|山脉|街道|房间|室内|庭院|花园|雪地|沙漠|和|与|以及|、|还有|旁边|一起)/
const MULTIPLE_COUNT =
  /(?:两|二|三|四|五|六|七|八|九|十|[2-9]\d*)[只匹棵朵个人座辆架艘]/

export function simpleObjectForCommand(
  command: DrawingCommand,
  userText: string,
): SceneObject | null {
  const name = command.properties?.name
  if (
    command.action !== 'create' ||
    !name ||
    SCENE_OR_RELATION.test(userText) ||
    MULTIPLE_COUNT.test(userText)
  ) {
    return null
  }

  const preset = findPreset(userText)
  if (!preset) return null

  return {
    name,
    prompt: `masterpiece, best quality, ${preset.prompt}`,
    ...(preset.negativeExtra ? { negativePrompt: preset.negativeExtra } : {}),
    background: 'transparent',
    isBackground: false,
    position:
      command.properties?.position &&
      [
        'top-left',
        'top',
        'top-right',
        'left',
        'center',
        'right',
        'bottom-left',
        'bottom',
        'bottom-right',
      ].includes(command.properties.position)
        ? (command.properties.position as SceneObject['position'])
        : 'center',
    size: 'medium',
  }
}
