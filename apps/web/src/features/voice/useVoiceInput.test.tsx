import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVoiceInput } from './useVoiceInput'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('useVoiceInput', () => {
  const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'mediaDevices',
  )

  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor)
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })

  it('records with the local provider and returns the transcript', async () => {
    const stopTrack = vi.fn()
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })

    class Recorder {
      state: RecordingState = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null

      start() {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({
          data: new Blob(['voice'], { type: this.mimeType }),
        } as BlobEvent)
        this.onstop?.()
      }
    }
    vi.stubGlobal('MediaRecorder', Recorder)

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      if (url === '/api/asr/health') {
        return jsonResponse({ provider: 'local', available: true })
      }
      if (url === '/api/asr/transcribe') {
        return jsonResponse({ text: '画一个太阳' })
      }
      throw new Error(`Unexpected fetch request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useVoiceInput(onTranscript))

    await waitFor(() => expect(result.current.mode).toBe('local'))

    await act(async () => result.current.toggle())
    expect(result.current.status.phase).toBe('listening')

    await act(async () => result.current.toggle())
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('画一个太阳'))

    expect(result.current.status.phase).toBe('success')
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/asr/transcribe',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
      }),
    )
  })

  it('reports a recoverable text fallback when no speech provider is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ provider: 'mock', available: false }),
        ),
    )

    const { result } = renderHook(() => useVoiceInput(vi.fn()))

    await waitFor(() => expect(result.current.mode).toBe('text'))
    expect(result.current.supported).toBe(false)
    expect(result.current.status).toMatchObject({
      phase: 'error',
      recoverable: true,
    })
  })

  it('reports microphone permission failures without leaving listening state', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ provider: 'local', available: true }),
        ),
    )

    const { result } = renderHook(() => useVoiceInput(vi.fn()))
    await waitFor(() => expect(result.current.mode).toBe('local'))
    await act(async () => result.current.toggle())

    expect(result.current.listening).toBe(false)
    expect(result.current.status).toMatchObject({
      phase: 'error',
      message: '无法使用麦克风，请检查浏览器权限。',
      recoverable: true,
    })
  })
})
