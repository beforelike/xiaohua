import type { DrawingCommand, SceneObject } from '@xiaohua/contracts'
import { findPreset } from './promptPresets'

const SCENE_OR_RELATION =
  /(?:背景|场景|草原|草地|草坪|森林|树林|河边|河流|小溪|溪流|湖边|湖泊|海边|海洋|天空|云层|山谷|山脉|街道|房间|室内|庭院|花园|雪地|沙漠|和|与|以及|、|还有|旁边|一起)/
const MULTIPLE_COUNT =
  /(?:两|二|三|四|五|六|七|八|九|十|[2-9]\d*)[只匹棵朵个人座辆架艘]/
const INTERACTION =
  /(?:玩耍|追逐|打闹|互动|一起|陪伴|对视|看着|望着|拥抱|抱着|争抢|扑|抓|追)/
const COUNT_VALUES: Record<string, number> = {
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}
const SUBJECTS = [
  {
    name: '小猫',
    keyword: /猫|小猫|猫咪/,
    english: 'cat',
    identity:
      'domestic cat, furry body, feline face, triangular ears, whiskers, visible tail, four legs with paws',
    negative:
      'dog, horse, bird, human, humanoid, abstract shape, ring, torus, random object',
  },
  {
    name: '小狗',
    keyword: /狗|小狗|狗狗/,
    english: 'dog',
    identity:
      'friendly dog, canine face, floppy ears, wagging tail, four legs with paws, furry body',
    negative: 'cat, horse, bird, human, humanoid, abstract random object',
  },
]

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

function parseCount(text: string) {
  const match = text.match(/([二两三四五六七八九十]|[2-9]\d*)[只匹棵朵个人座辆架艘]?/)
  if (!match?.[1]) return null
  return COUNT_VALUES[match[1]] ?? Number.parseInt(match[1], 10)
}

export function fallbackObjectsForCommand(
  command: DrawingCommand,
  userText: string,
): SceneObject[] {
  if (command.action !== 'create' || command.objectType === 'text') return []
  const count = parseCount(userText)
  if (!count || count < 2 || count > 6) {
    const simpleObject = simpleObjectForCommand(command, userText)
    return simpleObject ? [simpleObject] : []
  }
  const subject = SUBJECTS.find((candidate) => candidate.keyword.test(userText))
  if (!subject) return []
  const relation = INTERACTION.test(userText)
    ? `playing or interacting with the other ${subject.english}s`
    : `arranged as one of ${String(count)} distinct ${subject.english}s requested by the user`
  const positions: SceneObject['position'][] = [
    'left',
    'right',
    'center',
    'bottom-left',
    'bottom-right',
    'top-left',
  ]
  const background: SceneObject = {
    name: '背景',
    prompt: [
      `storybook play-area background for ${String(count)} ${subject.english}s`,
      'rich but unobtrusive environment details, clear ground plane, soft light',
      'open central space reserved for foreground subjects, no animals, no text',
    ].join(', '),
    negativePrompt:
      'cats, dogs, horses, people, main subject, foreground character, text, watermark, random abstract shapes',
    background: 'opaque',
    isBackground: true,
    position: 'center',
    size: 'full',
  }
  const foregrounds: SceneObject[] = Array.from({ length: count }, (_, index) => ({
    name: `${subject.name}${String(index + 1)}`,
    prompt: [
      `one distinct ${subject.english}`,
      subject.identity,
      relation,
      'complete body visible, generous empty margin',
      'isolated foreground asset, solid white background, no background',
    ].join(', '),
    identityPrompt: `${subject.english}, ${subject.identity}`,
    actionPrompt: relation,
    negativePrompt: [
      'complex background, busy background, cropped body, missing limbs, duplicate body',
      subject.negative,
    ].join(', '),
    background: 'transparent',
    isBackground: false,
    position: positions[index] ?? 'center',
    size: 'medium',
  }))
  return [background, ...foregrounds]
}
