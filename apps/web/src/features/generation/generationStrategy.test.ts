import { describe, expect, it } from 'vitest'
import type { SceneObject } from '@xiaohua/contracts'
import { shouldBuildCharacterAsset } from './generationStrategy'

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
