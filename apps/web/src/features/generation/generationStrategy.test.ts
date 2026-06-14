import { describe, expect, it } from 'vitest'
import type { SceneObject } from '@xiaohua/contracts'
import {
  shouldBuildCharacterAsset,
  shouldGenerateCohesiveScene,
} from './generationStrategy'

const cat: SceneObject = {
  name: '小猫',
  prompt: 'an adorable kitten',
  background: 'transparent',
  isBackground: false,
  position: 'center',
  size: 'medium',
}

describe('shouldBuildCharacterAsset', () => {
  it('skips the expensive character pipeline for a simple static object', () => {
    expect(shouldBuildCharacterAsset(cat, '画一只小猫')).toBe(false)
  })

  it('keeps character consistency for complex actions', () => {
    expect(
      shouldBuildCharacterAsset(
        { ...cat, actionPrompt: 'running quickly' },
        '画一只奔跑的小猫',
      ),
    ).toBe(true)
  })

  it('never builds character references for backgrounds', () => {
    expect(
      shouldBuildCharacterAsset(
        { ...cat, isBackground: true, background: 'opaque' },
        '奔跑的草原背景',
      ),
    ).toBe(false)
  })
})

describe('shouldGenerateCohesiveScene', () => {
  const mouse: SceneObject = {
    ...cat,
    name: '老鼠',
    prompt: 'a mouse fleeing from the cat',
  }
  const forest: SceneObject = {
    ...cat,
    name: '森林',
    prompt: 'a sunlit forest',
    background: 'opaque',
    isBackground: true,
    size: 'full',
  }

  it('uses one coherent image for a new relational scene', () => {
    expect(
      shouldGenerateCohesiveScene(
        [forest, { ...cat, actionPrompt: 'pouncing' }, mouse],
        '画一只猫追老鼠',
        false,
      ),
    ).toBe(true)
  })

  it('keeps explicit layered asset requests editable', () => {
    expect(
      shouldGenerateCohesiveScene(
        [cat, mouse],
        '把猫和老鼠分别生成为透明背景素材',
        false,
      ),
    ).toBe(false)
  })

  it('does not cover an existing composition with a new scene plate', () => {
    expect(shouldGenerateCohesiveScene([cat, mouse], '猫追老鼠', true)).toBe(
      false,
    )
  })
})
