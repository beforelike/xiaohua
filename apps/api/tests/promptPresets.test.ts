import { describe, expect, it } from 'vitest'
import { findPreset, promptPresets } from '../src/services/promptPresets'
import {
  buildNegativePrompt,
  buildPrompt,
} from '../src/services/imageGeneration'

describe('promptPresets', () => {
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
  })
})
