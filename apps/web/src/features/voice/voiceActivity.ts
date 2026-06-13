export const voiceActivityConfig = {
  sampleIntervalMs: 50,
  speechThreshold: 0.025,
  minimumSpeechMs: 150,
  endSilenceMs: 900,
  maximumUtteranceMs: 20_000,
} as const

export interface VoiceActivityState {
  voicedSince: number | null
  speechStarted: boolean
  lastVoiceAt: number | null
}

export function createVoiceActivityState(): VoiceActivityState {
  return {
    voicedSince: null,
    speechStarted: false,
    lastVoiceAt: null,
  }
}

export function calculateRms(samples: Uint8Array): number {
  if (samples.length === 0) return 0

  let squareSum = 0
  for (const sample of samples) {
    const normalized = (sample - 128) / 128
    squareSum += normalized * normalized
  }
  return Math.sqrt(squareSum / samples.length)
}

export function updateVoiceActivity(
  state: VoiceActivityState,
  rms: number,
  now: number,
): VoiceActivityState {
  if (rms >= voiceActivityConfig.speechThreshold) {
    const voicedSince = state.voicedSince ?? now
    return {
      voicedSince,
      speechStarted:
        state.speechStarted ||
        now - voicedSince >= voiceActivityConfig.minimumSpeechMs,
      lastVoiceAt: now,
    }
  }

  if (!state.speechStarted) {
    return { ...state, voicedSince: null }
  }
  return state
}

export function shouldFinishUtterance(
  state: VoiceActivityState,
  now: number,
): boolean {
  return Boolean(
    state.speechStarted &&
    state.lastVoiceAt !== null &&
    now - state.lastVoiceAt >= voiceActivityConfig.endSilenceMs,
  )
}
