import { describe, expect, it } from 'vitest'
import {
  calculateRms,
  createVoiceActivityState,
  shouldFinishUtterance,
  updateVoiceActivity,
} from './voiceActivity'

describe('voiceActivity', () => {
  it('ignores brief noise and finishes after sustained speech plus silence', () => {
    let state = createVoiceActivityState()
    state = updateVoiceActivity(state, 0.05, 0)
    state = updateVoiceActivity(state, 0, 50)
    expect(state.speechStarted).toBe(false)

    state = updateVoiceActivity(state, 0.05, 100)
    state = updateVoiceActivity(state, 0.05, 250)
    expect(state.speechStarted).toBe(true)
    expect(shouldFinishUtterance(state, 1_100)).toBe(false)
    expect(shouldFinishUtterance(state, 1_150)).toBe(true)
  })

  it('calculates normalized RMS from time-domain samples', () => {
    expect(calculateRms(new Uint8Array([128, 128]))).toBe(0)
    expect(calculateRms(new Uint8Array([128, 160]))).toBeCloseTo(
      Math.sqrt(0.03125),
    )
  })
})
