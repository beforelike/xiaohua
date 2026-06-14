import type { SceneObject } from '@xiaohua/contracts'

const COMPLEX_ACTION =
  /(?:奔跑|飞翔|跳跃|喝水|饮水|挥手|舞蹈|打斗|追逐|游泳|骑行|回头|转身|蹲下|躺下|奔腾|gallop|run|fly|jump|drink|wave|dance|fight|chase|swim|ride|turn|crouch|lie)/i

const SUBJECT_INTERACTION =
  /(?:抓|追|扑|打斗|对战|拥抱|抱着|牵着|骑|喂|亲吻|看着|望着|对话|交谈|一起|陪伴|躲避|逃离|跟随|争抢|玩耍|chase|catch|pounce|fight|hug|hold|ride|feed|kiss|look at|talk|play with|follow|flee)/i

const LAYERED_ASSET_REQUEST =
  /(?:分别|分开|逐个|图层|素材|贴纸|抠图|透明背景|白底|isolated|sticker|transparent background|separate layers)/i

export function shouldBuildCharacterAsset(
  object: SceneObject,
  userPrompt: string | undefined,
) {
  if (object.isBackground) return false
  return COMPLEX_ACTION.test(
    [userPrompt, object.prompt, object.actionPrompt].filter(Boolean).join(' '),
  )
}

export function shouldGenerateCohesiveScene(
  objects: SceneObject[],
  userPrompt: string | undefined,
  hasExistingLayers: boolean,
) {
  if (hasExistingLayers || objects.length < 2) return false
  const requestText = [
    userPrompt,
    ...objects.flatMap((object) => [object.prompt, object.actionPrompt]),
  ]
    .filter(Boolean)
    .join(' ')
  if (userPrompt && LAYERED_ASSET_REQUEST.test(userPrompt)) return false
  const foregroundCount = objects.filter(
    (object) => !object.isBackground,
  ).length
  return foregroundCount >= 2 && SUBJECT_INTERACTION.test(requestText)
}
