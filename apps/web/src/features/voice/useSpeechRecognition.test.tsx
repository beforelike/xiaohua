import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSpeechRecognition } from './useSpeechRecognition'

class Recognition {
  static latest: Recognition | null = null

  lang = ''
  continuous = false
  interimResults = false
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>
        resultIndex?: number
      }) => void)
    | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()

  constructor() {
    Recognition.latest = this
  }
}

describe('useSpeechRecognition', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
    Recognition.latest = null
  })

  it('keeps listening and uses the latest transcript callback', () => {
    vi.useFakeTimers()
    window.SpeechRecognition = Recognition
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()
    const { result, rerender } = renderHook(
      ({ callback }) => useSpeechRecognition(callback),
      { initialProps: { callback: firstCallback } },
    )

    act(() => result.current.toggle())
    expect(Recognition.latest?.continuous).toBe(true)
    expect(Recognition.latest?.start).toHaveBeenCalledOnce()

    rerender({ callback: secondCallback })
    act(() => {
      Recognition.latest?.onresult?.({
        resultIndex: 1,
        results: [[{ transcript: '旧指令' }], [{ transcript: '画一个太阳' }]],
      })
    })
    expect(firstCallback).not.toHaveBeenCalled()
    expect(secondCallback).toHaveBeenCalledWith('画一个太阳')

    act(() => {
      Recognition.latest?.onend?.()
      vi.advanceTimersByTime(250)
    })
    expect(Recognition.latest?.start).toHaveBeenCalledTimes(2)

    act(() => result.current.stop())
    act(() => {
      Recognition.latest?.onend?.()
      vi.advanceTimersByTime(250)
    })
    expect(Recognition.latest?.start).toHaveBeenCalledTimes(2)
  })
})
