import type { SceneObject } from '@xiaohua/contracts'

const COMPLEX_ACTION =
  /(?:奔跑|飞翔|跳跃|喝水|饮水|挥手|舞蹈|打斗|追逐|游泳|骑行|回头|转身|蹲下|躺下|奔腾|gallop|run|fly|jump|drink|wave|dance|fight|chase|swim|ride|turn|crouch|lie)/i

export function shouldBuildCharacterAsset(
  object: SceneObject,
  userPrompt: string | undefined,
) {
  if (object.isBackground) return false
  return COMPLEX_ACTION.test(
    [userPrompt, object.prompt, object.actionPrompt].filter(Boolean).join(' '),
  )
}
