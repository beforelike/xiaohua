import { describe, expect, it } from 'vitest'
import { resolveStylePrompt } from '../src/services/styleProfiles'

describe('styleProfiles', () => {
  it('expands common style names into reusable prompt templates', () => {
    expect(resolveStylePrompt('photorealistic wildlife photography')).toContain(
      'photorealistic editorial image of {prompt}',
    )
    expect(resolveStylePrompt('水彩童话')).toContain(
      'soft hand-painted storybook illustration of {prompt}',
    )
  })

  it('preserves explicit style templates', () => {
    expect(resolveStylePrompt('storybook poster of {prompt}, warm light')).toBe(
      'storybook poster of {prompt}, warm light',
    )
  })

  it('keeps custom unknown styles as authored', () => {
    expect(resolveStylePrompt('neon paper diorama')).toBe('neon paper diorama')
  })
})
