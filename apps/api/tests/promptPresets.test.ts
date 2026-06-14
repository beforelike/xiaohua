import { describe, expect, it } from 'vitest'
import { findPreset, promptPresets } from '../src/services/promptPresets'
import {
  buildNegativePrompt,
  buildPrompt,
  expectedSubjectCount,
} from '../src/services/imageGeneration'
import { requestedSubjectCount } from '../src/services/promptComposer'

describe('promptPresets', () => {
  it('detects requested subject counts in English and Chinese prompts', () => {
    expect(requestedSubjectCount('exactly two horses drinking')).toBe(2)
    expect(requestedSubjectCount('两匹马低头喝水')).toBe(2)
    expect(requestedSubjectCount('three birds flying')).toBe(3)
    expect(requestedSubjectCount('a horse running')).toBe(1)
  })

  it('inherits subject count from edit identity constraints', () => {
    expect(
      expectedSubjectCount({
        schemaVersion: 1,
        commandId: 'edit-horses',
        prompt: 'lower their heads to drink',
        identityConstraints: 'preserve exactly two horses',
        width: 512,
        height: 512,
        background: 'transparent',
      }),
    ).toBe(2)
  })

  describe('findPreset', () => {
    it('精确匹配关键词', () => {
      const result = findPreset('太阳')
      expect(result).not.toBeNull()
      expect(result?.prompt).toContain('sun')
    })

    it('匹配用户输入中包含的关键词', () => {
      const result = findPreset('一个可爱的太阳')
      expect(result).not.toBeNull()
      expect(result?.prompt).toContain('sun')
    })

    it('优先匹配更长的关键词', () => {
      // "草地" 比 "草" 更长，应优先匹配草地的预设
      const result = findPreset('一片草地')
      expect(result).not.toBeNull()
      expect(result?.prompt).toContain('grass field')
    })

    it('返回 null 对于无匹配内容', () => {
      const result = findPreset('宇宙黑洞')
      expect(result).toBeNull()
    })

    it('空字符串返回 null', () => {
      expect(findPreset('')).toBeNull()
      expect(findPreset('  ')).toBeNull()
    })

    it('所有预设都有至少一个关键词和 prompt', () => {
      for (const preset of promptPresets) {
        expect(preset.keywords.length).toBeGreaterThan(0)
        expect(preset.prompt.length).toBeGreaterThan(0)
      }
    })
  })

  describe('buildPrompt with presets', () => {
    it('匹配预设时使用预设的英文 prompt', () => {
      const result = buildPrompt('太阳', 'transparent')
      expect(result).toContain('sun')
      expect(result).toContain('masterpiece')
      expect(result).toContain('isolated object')
      // 不应包含原始中文
      expect(result).not.toContain('太阳')
    })

    it('无匹配时保留用户原始输入', () => {
      const result = buildPrompt('宇宙黑洞', 'opaque')
      expect(result).toContain('宇宙黑洞')
      expect(result).toContain('masterpiece')
    })

    it('opaque 背景不添加背景隔离标签', () => {
      const result = buildPrompt('树', 'opaque')
      expect(result).not.toContain('isolated object')
    })

    it('支持 Fooocus 风格的 {prompt} 模板并去除重复标签', () => {
      const result = buildPrompt(
        'red fox, sharp focus',
        'transparent',
        'storybook illustration of {prompt}, sharp focus',
        true,
      )
      expect(result).toContain('storybook illustration of red fox')
      expect(result.match(/sharp focus/g)).toHaveLength(1)
      expect(result.match(/isolated object/g)).toHaveLength(1)
      expect(result).toContain('entire object fully visible')
      expect(result).toContain('generous empty margin on all sides')
    })

    it('增强提示词不会再次注入通用质量词', () => {
      const result = buildPrompt(
        'a red fox',
        'opaque',
        'watercolor illustration',
        true,
      )
      expect(result).not.toContain('masterpiece')
      expect(result).toBe('watercolor illustration, a red fox')
    })

    it('多主体前景使用 subject group 而不是 single subject', () => {
      const result = buildPrompt(
        'two horses lowering their heads',
        'transparent',
        'realistic illustration',
        true,
      )
      expect(result).toContain('isolated subject group')
      expect(result).not.toContain('single subject')
    })
  })

  describe('buildNegativePrompt with presets', () => {
    it('匹配预设时追加专属负向提示词', () => {
      const result = buildNegativePrompt('太阳')
      expect(result).toContain('lowres')
      expect(result).toContain('realistic, photographic')
    })

    it('无匹配时只返回基础负向提示词', () => {
      const result = buildNegativePrompt('宇宙黑洞')
      expect(result).toContain('lowres')
      expect(result).not.toContain('realistic, photographic')
    })

    it('无 negativeExtra 的预设只返回基础负向提示词', () => {
      const result = buildNegativePrompt('草地')
      expect(result).toContain('lowres')
      // 草地预设没有 negativeExtra
      const grassPreset = findPreset('草地')
      expect(grassPreset?.negativeExtra).toBeUndefined()
    })

    it('前景对象追加隔离和形体约束并去除重复负向词', () => {
      const result = buildNegativePrompt(
        '小猫',
        'watermark, extra limbs',
        'transparent',
      )
      expect(result).toContain('complex background')
      expect(result).toContain('close-up')
      expect(result).toContain('extra limbs')
      expect(result.match(/watermark/g)).toHaveLength(1)
      expect(result.match(/extra limbs/g)).toHaveLength(1)
    })

    it('背景层不注入前景对象专用负向词', () => {
      const result = buildNegativePrompt('草地', undefined, 'opaque')
      expect(result).not.toContain('extra limbs')
      expect(result).not.toContain('complex background')
    })
  })
})
